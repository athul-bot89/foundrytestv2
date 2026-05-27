import os
import re
import json
from flask import Flask, request, jsonify, send_from_directory, Response
from flask_cors import CORS
from azure.identity import ClientSecretCredential
from azure.ai.projects import AIProjectClient
from dotenv import load_dotenv
from auth import require_auth

load_dotenv()

# In Docker, React build is copied to /app/static-build
# Locally, fall back to ../chat-app/dist
STATIC_BUILD_DIR = os.environ.get(
    "STATIC_BUILD_DIR",
    os.path.join(os.path.dirname(__file__), "..", "chat-app", "dist"),
)

app = Flask(__name__, static_folder=os.path.join(STATIC_BUILD_DIR, "static"), static_url_path="/static")
CORS(app)

endpoint = os.environ.get("AZURE_ENDPOINT")
agent_name = os.environ.get("AGENT_NAME")
agent_version = os.environ.get("AGENT_VERSION")

project_client = None

def _get_project_client():
    global project_client
    if project_client is None:
        credential = ClientSecretCredential(
            tenant_id=os.environ["AZURE_TENANT_ID"],
            client_id=os.environ["AZURE_CLIENT_ID"],
            client_secret=os.environ["AZURE_CLIENT_SECRET"],
        )
        project_client = AIProjectClient(
            endpoint=endpoint,
            credential=credential,
        )
    return project_client

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
@require_auth
def chat():
    try:
        data = request.get_json()
        messages = data.get("messages", [])
        user_id = request.user_id
        openai_client = _get_project_client().get_openai_client()

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
            extra_headers={"X-End-User-ID": user_id},
        )

        reply = sanitize_markdown(response.output_text)
        annotations = _extract_annotations(response)
        return jsonify({"reply": reply, "annotations": annotations})
    except Exception as e:
        print("Error:", str(e))
        return jsonify({"error": str(e)}), 500


@app.route("/api/chat/stream", methods=["POST"])
@require_auth
def chat_stream():
    """SSE streaming endpoint for real-time token-by-token responses."""
    try:
        data = request.get_json()
        messages = data.get("messages", [])
        user_id = request.user_id
    except Exception as e:
        return jsonify({"error": str(e)}), 400

    def generate():
        try:
            openai_client = _get_project_client().get_openai_client()
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
                extra_headers={"X-End-User-ID": user_id},
                stream=True,
            )
            full_text = ""
            annotations = []
            for event in stream:
                if event.type == "response.output_text.delta":
                    token = event.delta
                    full_text += token
                    # Send only the new token — frontend accumulates
                    yield f"data: {json.dumps({'delta': token})}\n\n"
                elif event.type == "response.completed":
                    # Extract annotations from the completed response
                    if hasattr(event, "response"):
                        annotations = _extract_annotations(event.response)
                    break
            # Send final sanitized full text as a replace to fix markdown
            final = sanitize_markdown(full_text)
            yield f"data: {json.dumps({'delta': final, 'replace': True, 'done': True, 'annotations': annotations})}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            print("Stream error:", str(e))
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return Response(generate(), mimetype="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_react(path):
    """Serve React build - static files or index.html for client-side routing."""
    if path and os.path.exists(os.path.join(STATIC_BUILD_DIR, path)):
        return send_from_directory(STATIC_BUILD_DIR, path)
    return send_from_directory(STATIC_BUILD_DIR, "index.html")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=3000, debug=True)
