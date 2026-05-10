"""
Servidor local para buscar transcrições do YouTube.
Usado pela extensão Chrome para exibir legendas completas no painel lateral.

Uso:
    python server.py

Endpoint:
    GET http://localhost:5000/transcript?v=VIDEO_ID
    GET http://localhost:5000/transcript?v=VIDEO_ID&lang=en

Anti-bloqueio:
    Usa browser-cookie3 para ler os cookies do Chrome/Firefox automaticamente.
    Mantenha o YouTube aberto e logado no navegador antes de iniciar o servidor.

Dependências:
    pip install flask flask-cors youtube-transcript-api browser-cookie3
"""

import re
import time
import logging

import browser_cookie3
from flask import Flask, request, jsonify
from flask_cors import CORS
from youtube_transcript_api import YouTubeTranscriptApi, NoTranscriptFound, TranscriptsDisabled

# ── Logging ────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app, origins=["*"])

# ── Cache em memória ───────────────────────────────────────────────────────────
# Evita requisições repetidas ao YouTube para o mesmo vídeo.
_cache: dict = {}
CACHE_TTL = 3600  # segundos (1 hora)


def _get_cookie_jar():
    """
    Tenta carregar cookies do YouTube do Chrome e depois do Firefox.
    Retorna um CookieJar ou None se nenhum navegador estiver disponível.
    """
    for browser_name, loader in [("Chrome", browser_cookie3.chrome),
                                  ("Firefox", browser_cookie3.firefox)]:
        try:
            jar = loader(domain_name=".youtube.com")
            # Verificar se o jar tem pelo menos um cookie relevante
            cookies = list(jar)
            if cookies:
                log.info("Cookies carregados do %s (%d cookies)", browser_name, len(cookies))
                return jar
        except Exception as e:
            log.debug("%s indisponível: %s", browser_name, e)

    log.warning("Nenhum cookie de navegador encontrado — requisições sem autenticação (risco de bloqueio)")
    return None


def _fetch_transcript(video_id: str, lang: str):
    """
    Busca a transcrição usando cookies do navegador.
    Faz fallback para qualquer idioma disponível se o idioma solicitado não existir.
    """
    jar = _get_cookie_jar()
    api = YouTubeTranscriptApi()

    fetch_kwargs = {"cookies": jar} if jar else {}

    try:
        return api.fetch(video_id, languages=[lang], **fetch_kwargs)
    except NoTranscriptFound:
        log.info("Idioma '%s' não encontrado para %s — tentando qualquer idioma", lang, video_id)
        return api.fetch(video_id, **fetch_kwargs)


# ── Rotas ──────────────────────────────────────────────────────────────────────

@app.route("/transcript")
def get_transcript():
    video_id = request.args.get("v", "").strip()
    lang     = request.args.get("lang", "en").strip()

    if not video_id:
        return jsonify({"error": "Missing video id (param: v)"}), 400

    # Verificar cache
    cache_key = f"{video_id}_{lang}"
    cached = _cache.get(cache_key)
    if cached and (time.time() - cached["ts"]) < CACHE_TTL:
        log.info("Cache hit: %s", video_id)
        return jsonify({
            "lines":    cached["lines"],
            "lang":     lang,
            "video_id": video_id,
            "cached":   True,
        })

    log.info("Buscando transcrição: %s (lang=%s)", video_id, lang)

    try:
        transcript = _fetch_transcript(video_id, lang)
    except TranscriptsDisabled:
        return jsonify({"error": "Transcripts are disabled for this video"}), 404
    except Exception as e:
        log.error("Erro ao buscar transcrição de %s: %s", video_id, e)
        return jsonify({"error": str(e)}), 500

    lines = [
        {
            "text":  re.sub(r"^>>\s*", "", entry.text).strip(),
            "start": entry.start,
            "dur":   entry.duration,
        }
        for entry in transcript
        if entry.text.strip() and entry.text.strip() != ">>"
    ]

    _cache[cache_key] = {"lines": lines, "ts": time.time()}
    log.info("OK: %s — %d linhas", video_id, len(lines))

    return jsonify({"lines": lines, "lang": lang, "video_id": video_id})


@app.route("/health")
def health():
    jar = _get_cookie_jar()
    return jsonify({
        "status":        "ok",
        "cookies_found": jar is not None,
        "cached_videos": len(_cache),
    })


# ── Inicialização ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 56)
    print("  Transcript Server  →  http://localhost:5000")
    print("=" * 56)

    jar = _get_cookie_jar()
    if jar:
        print("  ✔ Cookies do navegador carregados — autenticação ativa")
    else:
        print("  ✘ Nenhum cookie encontrado")
        print("    Abra o YouTube no Chrome ou Firefox e faça login")
        print("    antes de iniciar o servidor.")

    print("=" * 56)
    app.run(host="127.0.0.1", port=5000, debug=False)
