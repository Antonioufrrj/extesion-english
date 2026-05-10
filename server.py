"""
Servidor local para buscar transcrições do YouTube.
Usado pela extensão Chrome para exibir legendas completas no painel lateral.

Uso:
    python server.py

    Para contornar bloqueios de IP do YouTube, exporte seus cookies do Chrome
    usando a extensão "Get cookies.txt LOCALLY" e salve como cookies.txt na
    mesma pasta deste arquivo. O servidor usará os cookies automaticamente.

Endpoint:
    GET http://localhost:5000/transcript?v=VIDEO_ID
    GET http://localhost:5000/transcript?v=VIDEO_ID&lang=en
"""

import os
import re
from flask import Flask, request, jsonify
from flask_cors import CORS
from youtube_transcript_api import YouTubeTranscriptApi, NoTranscriptFound, TranscriptsDisabled

app = Flask(__name__)

# Permitir apenas requisições da extensão Chrome (origem chrome-extension://)
CORS(app, origins=["*"])

# Caminho para o arquivo de cookies (opcional — contorna bloqueios de IP)
COOKIES_FILE = os.path.join(os.path.dirname(__file__), "cookies.txt")


def make_api():
    """
    Cria uma instância da API.
    Se cookies.txt existir na mesma pasta, usa os cookies para autenticar
    e contornar bloqueios de IP do YouTube.
    """
    if os.path.isfile(COOKIES_FILE):
        print(f"  [cookies] Usando cookies de: {COOKIES_FILE}")
        return YouTubeTranscriptApi(cookie_path=COOKIES_FILE)
    return YouTubeTranscriptApi()


def fetch_transcript(video_id, lang):
    """
    Busca a transcrição compatível com youtube-transcript-api >= 0.6 e >= 1.x.
    Retorna uma lista de dicts {text, start, dur}.
    """
    api = make_api()

    # Tenta no idioma solicitado; fallback para qualquer idioma disponível
    try:
        transcript = api.fetch(video_id, languages=[lang])
    except NoTranscriptFound:
        transcript = api.fetch(video_id)

    lines = []
    for entry in transcript:
        # youtube-transcript-api >= 1.x: entry é um objeto FetchedTranscriptSnippet
        # com atributos .text, .start, .duration
        # Versões anteriores usavam dict-like com entry["text"] etc.
        try:
            text  = entry.text
            start = entry.start
            dur   = entry.duration
        except AttributeError:
            # Fallback para versões que retornam dicts
            text  = entry.get("text", "")
            start = entry.get("start", 0)
            dur   = entry.get("duration", 0)

        text = re.sub(r'^>>\s*', '', text).strip()
        if text and text != ">>":
            lines.append({"text": text, "start": start, "dur": dur})

    return lines


@app.route("/transcript")
def get_transcript():
    video_id = request.args.get("v", "").strip()
    lang = request.args.get("lang", "en").strip()

    if not video_id:
        return jsonify({"error": "Missing video id (param: v)"}), 400

    try:
        lines = fetch_transcript(video_id, lang)
    except NoTranscriptFound:
        return jsonify({"error": "No transcript found for this video"}), 404
    except TranscriptsDisabled:
        return jsonify({"error": "Transcripts are disabled for this video"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    return jsonify({"lines": lines, "lang": lang, "video_id": video_id})


@app.route("/health")
def health():
    cookies_loaded = os.path.isfile(COOKIES_FILE)
    return jsonify({"status": "ok", "cookies_loaded": cookies_loaded})


if __name__ == "__main__":
    print("=" * 50)
    print("  Transcript Server rodando em http://localhost:5000")
    print("  Mantenha esta janela aberta enquanto usa a extensão")
    if os.path.isfile(COOKIES_FILE):
        print(f"  Cookies carregados: {COOKIES_FILE}")
    else:
        print("  Sem cookies.txt — se o YouTube bloquear, veja o README")
    print("=" * 50)
    app.run(host="127.0.0.1", port=5000, debug=False)
