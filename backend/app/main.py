import base64
import secrets
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from app.api.routes import router
from app.config import get_settings
from app.store.db import Store
from app.translate.ollama import ModelUnavailable


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    data = Path(s.data_dir)
    (data / "media").mkdir(parents=True, exist_ok=True)
    app.state.settings = s
    app.state.store = Store(data / "mirabook.db")
    yield
    app.state.store.close()


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title="Mirabook API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Optional HTTP Basic auth — recommended when exposing over the internet.
    if s.basic_auth:
        expected = s.basic_auth

        @app.middleware("http")
        async def basic_auth(request: Request, call_next):
            header = request.headers.get("authorization", "")
            if header.startswith("Basic "):
                try:
                    decoded = base64.b64decode(header[6:]).decode()
                except Exception:
                    decoded = ""
                if secrets.compare_digest(decoded, expected):
                    return await call_next(request)
            return Response(
                status_code=401,
                headers={"WWW-Authenticate": 'Basic realm="Mirabook"'},
            )

    @app.exception_handler(ModelUnavailable)
    async def model_unavailable(_request: Request, exc: ModelUnavailable):
        """A model that was never pulled is a configuration problem with a
        one-line fix, not a server fault. Say which model and how to get it,
        rather than logging a traceback the reader never sees."""
        return JSONResponse(status_code=503, content={"detail": str(exc)})

    app.include_router(router, prefix="/api")

    media_dir = Path(s.data_dir) / "media"
    media_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/media", StaticFiles(directory=media_dir), name="media")

    # Optionally serve the built frontend (single-origin production deploy).
    if s.static_dir:
        static = Path(s.static_dir)
        if static.is_dir():

            @app.get("/{full_path:path}")
            async def spa(full_path: str):
                if full_path.startswith(("api/", "media/")):
                    return Response(status_code=404)
                candidate = static / full_path
                if full_path and candidate.is_file():
                    return FileResponse(candidate)
                return FileResponse(static / "index.html")

    return app


app = create_app()
