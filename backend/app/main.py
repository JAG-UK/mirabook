from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes import router
from app.config import get_settings
from app.store.db import Store


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
    app.include_router(router, prefix="/api")

    media_dir = Path(s.data_dir) / "media"
    media_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/media", StaticFiles(directory=media_dir), name="media")
    return app


app = create_app()
