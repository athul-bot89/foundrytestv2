import os
import re
import json
import logging
import jwt
from flask import Flask, request, jsonify, send_from_directory, Response
from flask_cors import CORS
from azure.core.credentials import AccessToken, TokenCredential
from azure.core.exceptions import ClientAuthenticationError, HttpResponseError
from azure.ai.projects import AIProjectClient
from openai import AuthenticationError as OpenAIAuthError, RateLimitError, BadRequestError
from dotenv import load_dotenv
from opencensus.ext.azure.log_exporter import AzureLogHandler

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

# Application Insights telemetry logger
APPINSIGHTS_CONNECTION_STRING = os.environ.get("APPLICATIONINSIGHTS_CONNECTION_STRING")
telemetry_logger = logging.getLogger("telemetry")
telemetry_logger.setLevel(logging.INFO)
telemetry_logger.propagate = False
if APPINSIGHTS_CONNECTION_STRING:
    try:
        _ai_handler = AzureLogHandler(connection_string=APPINSIGHTS_CONNECTION_STRING)
        _ai_handler.add_telemetry_processor(
            lambda envelope: envelope.tags.update({"ai.cloud.role": "foundrytestv2-backend"})
            or True
        )
        # Send regular backend logs to Application Insights
        logger.addHandler(_ai_handler)
        # Dedicated telemetry logger
        if not telemetry_logger.handlers:
            _telemetry_handler = AzureLogHandler(connection_string=APPINSIGHTS_CONNECTION_STRING)
            _telemetry_handler.add_telemetry_processor(
                lambda envelope: envelope.tags.update({"ai.cloud.role": "foundrytestv2-backend"})
                or True
            )
            telemetry_logger.addHandler(_telemetry_handler)
    except ValueError as e:
        logger.warning(f"Failed to initialize Application Insights: {e}")

# In Docker, React build is copied to /app/static-build
# Locally, fall back to ../chat-app/dist
STATIC_BUILD_DIR = os.environ.get(
    "STATIC_BUILD_DIR",
    os.path.join(os.path.dirname(__file__), "..", "chat-app", "dist"),
)

# Generate auth-config.js from runtime env vars (backup for when entrypoint.sh is bypassed)
_client_id = os.environ.get("CLIENT_ID", "")
_tenant_id = os.environ.get("TENANT_ID", "")
if _client_id and _tenant_id:
    _auth_config_path = os.path.join(STATIC_BUILD_DIR, "auth-config.js")
    try:
        with open(_auth_config_path, "w") as f:
            f.write(f'window.__AUTH_CONFIG__ = {{\n')
            f.write(f'  clientId: "{_client_id}",\n')
            f.write(f'  tenantId: "{_tenant_id}",\n')
            f.write(f'  scopes: ["https://ai.azure.com/.default"]\n')
            f.write(f'}};\n')
        logger.info("Generated auth-config.js with CLIENT_ID and TENANT_ID")
    except OSError as e:
        logger.warning(f"Could not write auth-config.js: {e}")

app = Flask(__name__, static_folder=os.path.join(STATIC_BUILD_DIR, "static"), static_url_path="/static")
CORS(app)

endpoint = os.environ.get("AZURE_ENDPOINT")
agent_name = os.environ.get("AGENT_NAME")
agent_version = os.environ.get("AGENT_VERSION")

# Model and cost configuration
MODEL_NAME = os.environ.get("MODEL_NAME", "gpt-4o")
COST_PER_PROMPT_TOKEN = float(os.environ.get("COST_PER_PROMPT_TOKEN", "0.0000025"))
COST_PER_COMPLETION_TOKEN = float(os.environ.get("COST_PER_COMPLETION_TOKEN", "0.000010"))


# SharePoint citation URL configuration
SHAREPOINT_LIBRARY_BASE = os.environ.get(
    "SHAREPOINT_LIBRARY_BASE",
    "https://pecopalletinc.sharepoint.com/sites/PECOFiles/Company%20Policies"
)
SHAREPOINT_SITE_PATH = os.environ.get(
    "SHAREPOINT_SITE_PATH",
    "/sites/PECOFiles/Company Policies"
)


def build_sharepoint_url(doc_url: str) -> str:
    """Convert a Graph API doc_url path to a clickable SharePoint URL.
    
    Input:  /drives/b!.../root:/Technology Acceptable Use.pdf
    Output: https://pecopalletinc.sharepoint.com/sites/PECOFiles/Company%20Policies/Forms/...
    """
    if not doc_url:
        return ""
    # Extract filename from "root:/filename.pdf"
    if "root:/" in doc_url:
        filename = doc_url.split("root:/")[-1]
    else:
        filename = doc_url.rsplit("/", 1)[-1]
    if not filename:
        return ""
    # Build the SharePoint URL
    import urllib.parse
    file_path = f"{SHAREPOINT_SITE_PATH}/{filename}"
    params = urllib.parse.urlencode({
        "id": file_path,
        "parent": SHAREPOINT_SITE_PATH
    })
    return f"{SHAREPOINT_LIBRARY_BASE}/Forms/All%20Documents%20%20Formatted.aspx?{params}"


class UserTokenCredential(TokenCredential):
    """Wraps a user's access token to satisfy the TokenCredential interface."""
    def __init__(self, token: str):
        self._token = token

    def get_token(self, *scopes, **kwargs):
        return AccessToken(self._token, 0)


def _get_bearer_token():
    """Extract Bearer token from the Authorization header."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    return auth_header[7:]


def _get_user_email_from_token(token: str) -> str:
    """Decode JWT token (without verification) to extract user email."""
    try:
        claims = jwt.decode(token, options={"verify_signature": False})
        return claims.get("preferred_username") or claims.get("email") or claims.get("upn", "unknown")
    except Exception:
        return "unknown"


def track_consumption(agent_id, thread_id, user_email, completion_tokens, prompt_tokens, client_ip):
    """Log consumption event to Application Insights."""
    prompt_tok = int(prompt_tokens or 0)
    completion_tok = int(completion_tokens or 0)
    cost = (prompt_tok * COST_PER_PROMPT_TOKEN) + (completion_tok * COST_PER_COMPLETION_TOKEN)
    telemetry_logger.info(
        "Consumption",
        extra={
            "custom_dimensions": {
                "event_type": "Consumption",
                "agent_id": agent_id or "",
                "thread_id": thread_id or "",
                "user_email": user_email or "",
                "completion_tokens": str(completion_tok),
                "prompt_tokens": str(prompt_tok),
                "model_name": MODEL_NAME,
                "cost": str(round(cost, 10)),
                "client_ip": client_ip or "",
            }
        },
    )


def track_feedback(agent_id, thread_id, user_email, last_agent_msg, last_user_msg, feedback, conversation):
    """Log feedback event to Application Insights."""
    # Map like/dislike to positive/negative
    feedback_mapped = feedback or ""
    if feedback_mapped == "like":
        feedback_mapped = "positive"
    elif feedback_mapped == "dislike":
        feedback_mapped = "negative"

    telemetry_logger.info(
        "Feedback",
        extra={
            "custom_dimensions": {
                "event_type": "Feedback",
                "agent_id": agent_id or "",
                "thread_id": thread_id or "",
                "user_email": user_email or "",
                "last_agent_msg": (last_agent_msg or "")[:500],
                "last_user_msg": (last_user_msg or "")[:500],
                "feedback": feedback_mapped,
                "full_conversation": (conversation or "")[:8000],
            }
        },
    )


def _get_project_client_for_token(token: str):
    """Create an AIProjectClient using the user's access token."""
    credential = UserTokenCredential(token)
    return AIProjectClient(endpoint=endpoint, credential=credential)


def _get_openai_client_for_token(token: str):
    """Create an OpenAI client via the project client (already routes through APIM)."""
    return _get_project_client_for_token(token).get_openai_client(max_retries=0)

@app.route("/health")
def health():
    return jsonify({"status": "ok"})


def sanitize_markdown(text):
    """Fix common markdown issues from LLM output like unbalanced asterisks.
    Citations are preserved for frontend rendering."""
    # Fix lines with unclosed/mismatched bold: "1. **text:" or "1. **text*:"
    # The (?!\*) lookahead ensures we skip already-correct "1. **text:**"
    text = re.sub(
        r'^(\d+\.\s+)\*\*([^*\n]+?)(\*{0,1}):(?!\*)',
        r'\1**\2:**',
        text,
        flags=re.MULTILINE,
    )
    # Fix lines with unclosed single italic: "1. *text:"
    text = re.sub(
        r'^(\d+\.\s+)\*([^*\n]+?)(\*{0,1}):(?!\*)',
        r'\1**\2:**',
        text,
        flags=re.MULTILINE,
    )
    return text


def _is_internal_doc_id(name):
    """Check if a filename is just an internal reference ID like doc_0, doc_1, etc."""
    if not name:
        return True
    # Match patterns like: doc_0, doc_1, source, chunk_3, etc.
    return bool(re.match(r'^(doc|chunk|source|ref|item)[-_]?\d*$', name.lower()))


def _extract_annotations(response):
    """Extract document citations from response by parsing tool call results.
    
    The Foundry KB tool returns results with doc_url fields like:
      /drives/b!.../root:/Technology Acceptable Use.pdf
    These are converted to clickable SharePoint URLs.
    """
    annotations = []
    seen_files = set()
    doc_urls_from_tools = []

    # Debug: log all output item types to understand the response structure
    try:
        output_types = [(getattr(item, "type", "unknown"), type(item).__name__) for item in response.output]
        logger.info("Response output items: %s", output_types)
    except Exception:
        pass

    # Step 1: Extract doc_url values from tool call results in response.output
    try:
        for output_item in response.output:
            item_type = getattr(output_item, "type", "")
            logger.debug("Output item type=%s, attrs=%s", item_type,
                        [a for a in dir(output_item) if not a.startswith("_")])
            
            # Check for tool/function call outputs that contain KB results
            output_text = ""
            if item_type == "function_call_output":
                output_text = getattr(output_item, "output", "") or ""
            elif item_type in ("mcp_call_output", "tool_call_output", "mcp_list_tools"):
                output_text = getattr(output_item, "output", "") or getattr(output_item, "result", "") or ""
            
            # Also check content parts for text that might contain doc_url
            if not output_text and hasattr(output_item, "content"):
                for content_part in getattr(output_item, "content", []) or []:
                    text = getattr(content_part, "text", "") or ""
                    if "doc_url" in text:
                        output_text += text
            
            # Parse doc_url from tool results
            if output_text and "doc_url" in output_text:
                doc_url_matches = re.findall(r'"doc_url"\s*:\s*"([^"]+)"', output_text)
                for doc_url in doc_url_matches:
                    if "root:/" in doc_url:
                        filename = doc_url.split("root:/")[-1]
                        if filename and filename not in seen_files:
                            seen_files.add(filename)
                            url = build_sharepoint_url(doc_url)
                            doc_urls_from_tools.append({"filename": filename, "url": url})
                            logger.info("Citation from tool result: %s -> %s", filename, url)
    except Exception as e:
        logger.warning("Error parsing tool call results for citations: %s", e)

    if doc_urls_from_tools:
        annotations = doc_urls_from_tools
    else:
        # Step 2: Try structured annotations on the response content
        try:
            for output_item in response.output:
                if hasattr(output_item, "content"):
                    for content_part in output_item.content:
                        if hasattr(content_part, "annotations"):
                            for ann in content_part.annotations:
                                # Log what we actually get from annotations
                                ann_type = getattr(ann, "type", "unknown")
                                ann_filename = getattr(ann, "filename", None)
                                ann_url = getattr(ann, "url", None)
                                ann_title = getattr(ann, "title", None)
                                ann_file_id = getattr(ann, "file_id", None)
                                logger.info("Annotation: type=%s filename=%s url=%s title=%s file_id=%s",
                                           ann_type, ann_filename, ann_url, ann_title, ann_file_id)

                                entry = {}
                                filename = ann_filename or ann_title
                                url = ann_url or ""

                                # If URL is a drive path, convert it
                                if url and "root:/" in url:
                                    filename = url.split("root:/")[-1] or filename
                                    entry["url"] = build_sharepoint_url(url)
                                elif url and "search.windows.net" in url:
                                    # KB endpoint - not a document URL, skip
                                    continue
                                elif url and url.startswith("http"):
                                    entry["url"] = url

                                # Skip internal IDs like doc_0, doc_1
                                if _is_internal_doc_id(filename):
                                    logger.debug("Skipping internal doc ID: %s", filename)
                                    continue

                                if filename:
                                    entry["filename"] = filename
                                    if "url" not in entry:
                                        entry["url"] = build_sharepoint_url(f"root:/{filename}")

                                dedup_key = entry.get("filename")
                                if entry and dedup_key and dedup_key not in seen_files:
                                    seen_files.add(dedup_key)
                                    annotations.append(entry)
        except Exception as e:
            logger.warning("Error extracting structured annotations: %s", e)

        # Step 3: Fallback - parse citation markers from the response text
        if not annotations:
            try:
                text = response.output_text or ""
                markers = re.findall(r'【[^】]*?†([^】]*?)】', text)
                for source in markers:
                    if source and not _is_internal_doc_id(source) and source not in seen_files:
                        seen_files.add(source)
                        url = build_sharepoint_url(f"root:/{source}")
                        annotations.append({"filename": source, "url": url})
            except Exception:
                pass

    logger.info("Total citations extracted: %d | files: %s", len(annotations),
                [a.get("filename") for a in annotations])
    return annotations


@app.route("/api/chat", methods=["POST"])
def chat():
    token = _get_bearer_token()
    if not token:
        logger.warning("Chat request missing Authorization header")
        return jsonify({"error": "Missing Authorization header", "code": "AUTH_MISSING"}), 401
    try:
        data = request.get_json()
        if not data or not data.get("messages"):
            return jsonify({"error": "Request body must include 'messages'", "code": "BAD_REQUEST"}), 400
        messages = data.get("messages", [])
        openai_client = _get_openai_client_for_token(token)

        response = openai_client.responses.create(
            input=[
                {"role": msg["role"], "content": msg["content"]}
                for msg in messages
            ],
            include=["file_search_call.results", "message.input_image.image_url"],
            extra_body={
                "agent_reference": {
                    "name": agent_name,
                    "version": agent_version,
                    "type": "agent_reference",
                }
            },
        )

        reply = sanitize_markdown(response.output_text)
        annotations = _extract_annotations(response)
        message_id = getattr(response, "id", None) or ""

        # Track consumption in Application Insights
        user_email = _get_user_email_from_token(token)
        thread_id = data.get("threadId", "")
        usage = getattr(response, "usage", None)
        completion_tokens = getattr(usage, "output_tokens", 0) if usage else 0
        prompt_tokens = getattr(usage, "input_tokens", 0) if usage else 0
        forwarded_for = request.headers.get("X-Forwarded-For", "")
        client_ip = forwarded_for.split(",")[0].strip() if forwarded_for else request.remote_addr
        track_consumption(
            agent_id=agent_name,
            thread_id=thread_id,
            user_email=user_email,
            completion_tokens=completion_tokens,
            prompt_tokens=prompt_tokens,
            client_ip=client_ip,
        )

        logger.info("POST /api/chat | user=%s | tokens=%d/%d", user_email, prompt_tokens, completion_tokens)
        return jsonify({"reply": reply, "annotations": annotations, "messageId": message_id})
    except (ClientAuthenticationError, OpenAIAuthError) as e:
        msg = getattr(e, 'message', str(e))
        logger.error("Auth failed: %s", msg)
        return jsonify({"error": "Session expired — please sign out and sign in again.", "code": "AUTH_FAILED"}), 401
    except RateLimitError as e:
        logger.warning("Rate limited: %s", e)
        return jsonify({"error": "Rate limit exceeded. Please wait a moment and try again.", "code": "RATE_LIMITED"}), 429
    except BadRequestError as e:
        logger.error("Bad request to upstream: %s", e)
        return jsonify({"error": "Invalid request — please try rephrasing your message.", "code": "BAD_REQUEST"}), 400
    except HttpResponseError as e:
        logger.error("Azure API error [%s]: %s", e.status_code, e.message)
        return jsonify({"error": e.message, "code": "UPSTREAM_ERROR", "status": e.status_code}), 502
    except Exception as e:
        logger.exception("Unexpected error in /api/chat")
        return jsonify({"error": str(e), "code": "INTERNAL_ERROR"}), 500


@app.route("/api/chat/stream", methods=["POST"])
def chat_stream():
    """SSE streaming endpoint for real-time token-by-token responses."""
    token = _get_bearer_token()
    if not token:
        logger.warning("Stream request missing Authorization header")
        return jsonify({"error": "Missing Authorization header", "code": "AUTH_MISSING"}), 401
    try:
        data = request.get_json()
        if not data or not data.get("messages"):
            return jsonify({"error": "Request body must include 'messages'", "code": "BAD_REQUEST"}), 400
        messages = data.get("messages", [])
    except Exception as e:
        logger.error("Failed to parse stream request body: %s", e)
        return jsonify({"error": "Invalid request body", "code": "BAD_REQUEST"}), 400

    # Capture request context values before entering the generator
    forwarded_for = request.headers.get("X-Forwarded-For", "")
    client_ip = forwarded_for.split(",")[0].strip() if forwarded_for else request.remote_addr

    def generate():
        try:
            openai_client = _get_openai_client_for_token(token)
            stream = openai_client.responses.create(
                input=[
                    {"role": msg["role"], "content": msg["content"]}
                    for msg in messages
                ],
                include=["file_search_call.results", "message.input_image.image_url"],
                extra_body={
                    "agent_reference": {
                        "name": agent_name,
                        "version": agent_version,
                        "type": "agent_reference",
                    }
                },
                stream=True,
            )
            full_text = ""
            annotations = []
            message_id = ""
            for event in stream:
                if event.type == "response.output_text.delta":
                    chunk = event.delta
                    full_text += chunk
                    yield f"data: {json.dumps({'delta': chunk})}\n\n"
                elif event.type == "response.completed":
                    if hasattr(event, "response"):
                        annotations = _extract_annotations(event.response)
                        message_id = getattr(event.response, "id", None) or ""
                        # Track consumption in Application Insights
                        user_email = _get_user_email_from_token(token)
                        thread_id = data.get("threadId", "")
                        usage = getattr(event.response, "usage", None)
                        completion_tokens = getattr(usage, "output_tokens", 0) if usage else 0
                        prompt_tokens = getattr(usage, "input_tokens", 0) if usage else 0
                        track_consumption(
                            agent_id=agent_name,
                            thread_id=thread_id,
                            user_email=user_email,
                            completion_tokens=completion_tokens,
                            prompt_tokens=prompt_tokens,
                            client_ip=client_ip,
                        )
                        logger.info("POST /api/chat/stream | user=%s | tokens=%d/%d", user_email, prompt_tokens, completion_tokens)
                    break
            # Send final sanitized full text as a replace to fix markdown
            final = sanitize_markdown(full_text)
            yield f"data: {json.dumps({'delta': final, 'replace': True, 'done': True, 'annotations': annotations, 'messageId': message_id})}\n\n"
            yield "data: [DONE]\n\n"
        except (ClientAuthenticationError, OpenAIAuthError) as e:
            logger.error("Auth failed during stream: %s", e)
            yield f"data: {json.dumps({'error': 'Session expired — please sign out and sign in again.', 'code': 'AUTH_FAILED'})}\n\n"
        except RateLimitError as e:
            logger.warning("Rate limited during stream: %s", e)
            yield f"data: {json.dumps({'error': 'Rate limit exceeded. Please wait a moment and try again.', 'code': 'RATE_LIMITED'})}\n\n"
        except BadRequestError as e:
            logger.error("Bad request during stream: %s", e)
            yield f"data: {json.dumps({'error': 'Invalid request — please try rephrasing your message.', 'code': 'BAD_REQUEST'})}\n\n"
        except HttpResponseError as e:
            logger.error("Azure API error during stream [%s]: %s", e.status_code, e.message)
            yield f"data: {json.dumps({'error': e.message, 'code': 'UPSTREAM_ERROR'})}\n\n"
        except Exception as e:
            logger.exception("Unexpected error in /api/chat/stream")
            yield f"data: {json.dumps({'error': str(e), 'code': 'INTERNAL_ERROR'})}\n\n"

    return Response(generate(), mimetype="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })


@app.route("/api/feedback", methods=["POST"])
def feedback():
    """Log user feedback (like/dislike) for a chat message."""
    token = _get_bearer_token()
    if not token:
        return jsonify({"error": "Missing Authorization header", "code": "AUTH_MISSING"}), 401
    try:
        data = request.get_json()
        if not data or "rating" not in data:
            return jsonify({"error": "Request body must include 'rating'", "code": "BAD_REQUEST"}), 400

        rating = data.get("rating")
        message_index = data.get("messageIndex")
        message_content = (data.get("messageContent") or "")[:200]
        user_id = data.get("userId", "unknown")
        thread_id = data.get("threadId", "")
        message_id = data.get("messageId", "")
        last_user_msg = data.get("lastUserMsg", "")
        last_agent_msg = data.get("lastAgentMsg", "")
        conversation = data.get("conversation", "")

        logger.info(
            "FEEDBACK | user=%s | threadId=%s | messageId=%s | messageIndex=%s | rating=%s | content=%s",
            user_id,
            thread_id,
            message_id,
            message_index,
            rating,
            message_content,
        )

        # Track feedback in Application Insights
        user_email = _get_user_email_from_token(token)
        track_feedback(
            agent_id=agent_name,
            thread_id=thread_id,
            user_email=user_email,
            last_agent_msg=last_agent_msg or message_content,
            last_user_msg=last_user_msg,
            feedback=rating,
            conversation=conversation,
        )

        return jsonify({"status": "ok"})
    except Exception as e:
        logger.exception("Unexpected error in /api/feedback")
        return jsonify({"error": str(e), "code": "INTERNAL_ERROR"}), 500


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_react(path):
    """Serve React build - static files or index.html for client-side routing."""
    if path and os.path.exists(os.path.join(STATIC_BUILD_DIR, path)):
        return send_from_directory(STATIC_BUILD_DIR, path)
    return send_from_directory(STATIC_BUILD_DIR, "index.html")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=3000, debug=True)
