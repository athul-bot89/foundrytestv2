import os
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from azure.identity import ClientSecretCredential
from azure.ai.projects import AIProjectClient
from dotenv import load_dotenv

load_dotenv()

# In Docker, React build is copied to /app/static-build
# Locally, fall back to ../chat-app/build
STATIC_BUILD_DIR = os.environ.get(
    "STATIC_BUILD_DIR",
    os.path.join(os.path.dirname(__file__), "..", "chat-app", "build"),
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


@app.route("/api/chat", methods=["POST"])
def chat():
    try:
        data = request.get_json()
        messages = data.get("messages", [])
        user_id = data.get("userId", "anonymous")
        openai_client = _get_project_client().get_openai_client()


        print(user_id, messages)

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

        return jsonify({"reply": response.output_text})
    except Exception as e:
        print("Error:", str(e))
        return jsonify({"error": str(e)}), 500


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_react(path):
    """Serve React build - static files or index.html for client-side routing."""
    if path and os.path.exists(os.path.join(STATIC_BUILD_DIR, path)):
        return send_from_directory(STATIC_BUILD_DIR, path)
    return send_from_directory(STATIC_BUILD_DIR, "index.html")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=3000, debug=True)
