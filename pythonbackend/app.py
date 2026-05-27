import os
import re
import json
import logging
from flask import Flask, request, jsonify, send_from_directory, Response
from flask_cors import CORS
from azure.core.credentials import AccessToken, TokenCredential
from azure.core.exceptions import ClientAuthenticationError, HttpResponseError
from azure.ai.projects import AIProjectClient
from openai import AuthenticationError as OpenAIAuthError, RateLimitError, BadRequestError
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

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


def _get_project_client_for_token(token: str):
    """Create an AIProjectClient using the user's access token."""
    credential = UserTokenCredential(token)
    return AIProjectClient(endpoint=endpoint, credential=credential)

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


def _extract_annotations(response):
    """Extract file citation annotations from the response to get real source names."""
    annotations = []
    try:
        for output_item in response.output:
            if hasattr(output_item, "content"):
                for content_part in output_item.content:
                    if hasattr(content_part, "annotations"):
                        for ann in content_part.annotations:
                            entry = {}
                            if hasattr(ann, "filename") and ann.filename:
                                entry["filename"] = ann.filename
                            elif hasattr(ann, "title") and ann.title:
                                entry["filename"] = ann.title
                            if hasattr(ann, "file_id"):
                                entry["file_id"] = ann.file_id
                            if hasattr(ann, "url") and ann.url:
                                entry["url"] = ann.url
                            if entry:
                                annotations.append(entry)
    except Exception:
        pass
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
        openai_client = _get_project_client_for_token(token).get_openai_client()

        response = openai_client.responses.create(
            input=[
                {"role": msg["role"], "content": msg["content"]}
                for msg in messages
            ],
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

    def generate():
        try:
            openai_client = _get_project_client_for_token(token).get_openai_client()
            stream = openai_client.responses.create(
                input=[
                    {"role": msg["role"], "content": msg["content"]}
                    for msg in messages
                ],
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

        logger.info(
            "FEEDBACK | user=%s | threadId=%s | messageId=%s | messageIndex=%s | rating=%s | content=%s",
            user_id,
            thread_id,
            message_id,
            message_index,
            rating,
            message_content,
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
