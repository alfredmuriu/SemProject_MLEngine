"""HTTP service the ERP calls to get predictions and flock reviews.

    uvicorn ml_engine.api:app --reload
    then open http://127.0.0.1:8000 for the FlockWise web app,
    or http://127.0.0.1:8000/docs to try the endpoints directly

Set MODEL_PATH to use a model somewhere other than models/egg_model.joblib.
"""
import json
import os
from functools import lru_cache
from pathlib import Path
from typing import List, Optional

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import model
from .agent import FlockAgent
from .data import FEATURES
from .train import DEFAULT_MODEL_PATH

WEB_DIR = Path(__file__).parent / "web"
SAMPLE_FLOCK = Path(__file__).parent.parent / "examples" / "flock_today.json"

app = FastAPI(title="Poultry ERP - ML Engine", version="0.2.0")
app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")


class BirdRecord(BaseModel):
    """One bird on one day. Only GallusID and Age are required - the model
    fills anything else that is missing."""

    GallusID: str
    Age: float = Field(..., ge=0, description="age in days")
    GallusWeight: Optional[float] = None
    GallusEggWeight: Optional[float] = None
    AmountOfFeed: Optional[float] = Field(None, description="feed given today, grams")
    SunLightExposure: Optional[float] = Field(None, description="hours of light")
    GallusBreed: Optional[str] = None
    GallusEggColor: Optional[str] = None
    GallusCombType: Optional[str] = None
    GallusLegShanksColor: Optional[str] = None
    GallusBeakColor: Optional[str] = None
    GallusPlumage: Optional[str] = None
    EggsCollected: Optional[int] = Field(None, ge=0, description="actual eggs collected today")


@lru_cache(maxsize=1)
def get_bundle():
    # Loaded on the first request rather than at import, so the API module
    # can be imported (and tested) without a trained model on disk.
    path = os.environ.get("MODEL_PATH", DEFAULT_MODEL_PATH)
    if not os.path.exists(path):
        raise HTTPException(503, f"No model at {path} - run `python -m ml_engine.train` first.")
    return model.load(path)


def get_agent(bundle: dict = Depends(get_bundle)):
    return FlockAgent(bundle["pipeline"])


@app.get("/", include_in_schema=False)
def web_app():
    return FileResponse(WEB_DIR / "index.html")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/model")
def model_info(bundle: dict = Depends(get_bundle)):
    """How the loaded model was trained and evaluated."""
    return {
        "model": type(bundle["pipeline"].named_steps["model"]).__name__,
        "n_birds": bundle.get("n_birds"),
        "metrics": bundle.get("metrics", {}),
        "sklearn_version": bundle.get("sklearn_version"),
        "features": FEATURES,
    }


@app.get("/sample-flock")
def sample_flock():
    """The demo flock in examples/, so the web app has something to load."""
    return json.loads(SAMPLE_FLOCK.read_text(encoding="utf-8"))


@app.post("/predict")
def predict(records: List[BirdRecord], agent: FlockAgent = Depends(get_agent)):
    rows = [r.model_dump() for r in records]
    expected = agent.expected_eggs(rows) if rows else []
    return {
        "predictions": [
            {"GallusID": r["GallusID"], "expected_eggs": round(float(e), 3)}
            for r, e in zip(rows, expected)
        ]
    }


@app.post("/flock/review")
def review(records: List[BirdRecord], agent: FlockAgent = Depends(get_agent)):
    if not records:
        raise HTTPException(422, "Send at least one bird record.")
    return agent.review_day(r.model_dump() for r in records)
