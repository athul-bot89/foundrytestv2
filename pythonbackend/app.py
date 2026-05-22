from flask import Flask, request, jsonify
from flask_cors import CORS
from azure.identity import ClientSecretCredential
from azure.ai.projects import AIProjectClient

app = Flask(__name__)
CORS(app)

endpoint = os.environ["AZURE_ENDPOINT"]

agent_name = "weather-agent"
agent_version = "2"

credential = ClientSecretCredential(
    tenant_id=os.environ["AZURE_TENANT_ID"],
    client_id=os.environ["AZURE_CLIENT_ID"],
    client_secret=os.environ["AZURE_CLIENT_SECRET"],
)

project_client = AIProjectClient(
    endpoint=endpoint,
    credential=credential,
)

@app.route("/api/chat", methods=["POST"])
def chat():
    try:
        data = request.get_json()
        messages = data.get("messages", [])
        user_id = data.get("userId", "anonymous")
        openai_client = project_client.get_openai_client()


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


if __name__ == "__main__":
    app.run(port=3001, debug=True)
