"""
Servidor local para buscar transcrições do YouTube.
Usado pela extensão Chrome para exibir legendas completas no painel lateral.

Uso:
    python server.py

Endpoint:
    GET http://localhost:5000/transcript?v=VIDEO_ID
    GET http://localhost:5000/transcript?v=VIDEO_ID&lang=en
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
from youtube_transcript_api import YouTubeTranscriptApi, NoTranscriptFound, TranscriptsDisabled

app = Flask(__name__)

# Permitir apenas requisições da extensão Chrome (origem chrome-extension://)
CORS(app, origins=["*"])


@app.route("/transcript")
def get_transcript():
    video_id = request.args.get("v", "").strip()
    lang = request.args.get("lang", "en").strip()

    if not video_id:
        return jsonify({"error": "Missing video id (param: v)"}), 400

    api = YouTubeTranscriptApi()

    try:
        # Tentar buscar no idioma solicitado primeiro
        transcript = api.fetch(video_id, languages=[lang])
    except NoTranscriptFound:
        try:
            # Fallback: qualquer idioma disponível
            transcript = api.fetch(video_id)
        except Exception as e:
            return jsonify({"error": str(e)}), 404
    except TranscriptsDisabled:
        return jsonify({"error": "Transcripts are disabled for this video"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    # Converter para lista de dicts simples
    lines = [
        {
            "text":  entry.text,
            "start": entry.start,
            "dur":   entry.duration
        }
        for entry in transcript
        if entry.text.strip()
    ]

    return jsonify({"lines": lines, "lang": lang, "video_id": video_id})


@app.route("/health")
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    print("=" * 50)
    print("  Transcript Server rodando em http://localhost:5000")
    print("  Mantenha esta janela aberta enquanto usa a extensão")
    print("=" * 50)
    app.run(host="127.0.0.1", port=5000, debug=False)
