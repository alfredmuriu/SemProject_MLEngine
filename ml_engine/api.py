"""HTTP service the ERP calls to get laying-rate forecasts and flock reviews.

    uvicorn ml_engine.api:app --reload
    then open http://127.0.0.1:8000 for the FlockWise web app,
    or http://127.0.0.1:8000/docs to try the endpoints directly

Set MODEL_PATH to use a model somewhere other than models/flock_forecaster.joblib.
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
from .data import MIN_WEEKS
from .train import DEFAULT_MODEL_PATH

WEB_DIR = Path(__file__).parent / "web"
SAMPLE_FLOCK = Path(__file__).parent.parent / "examples" / "sample_flock.json"
DATA_SOURCE = {
    "citation": (
        "Cabezas-Garcia, Rodriguez-Aguilar & Betancourt Lopez (2024). Evaluation of the historical "
        "performance of Lohmann Brown-Classic laying hens maintained on a conventional cage system "
        "in Colombia. Mendeley Data."
    ),
    "url": "https://data.mendeley.com/datasets/t2gzbht99m",
    "licence": "CC BY 4.0",
}

app = FastAPI(title="Poultry ERP - ML Engine", version="0.3.0")
app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")


class WeekRecord(BaseModel):
    """One week of a flock's records."""

    age_weeks: int = Field(..., ge=1, description="age of the flock that week, in weeks")
    hens: int = Field(..., gt=0, description="hens alive at the end of the week")
    eggs: int = Field(..., ge=0, description="eggs collected during the week")
    feed_kg: float = Field(..., ge=0, description="feed used during the week, kg")
    deaths: Optional[int] = Field(
        None, ge=0, description="birds that died or were culled; worked out from the drop in hens if left out"
    )


class Flock(BaseModel):
    flock_id: Optional[str] = None
    weeks: List[WeekRecord] = Field(..., description=f"consecutive weeks, oldest first, at least {MIN_WEEKS}")


@lru_cache(maxsize=1)
def get_bundle():
    # Loaded on the first request rather than at import, so the API module
    # can be imported (and tested) without a trained model on disk.
    path = os.environ.get("MODEL_PATH", DEFAULT_MODEL_PATH)
    if not os.path.exists(path):
        raise HTTPException(503, f"No model at {path} - run `python -m ml_engine.train` first.")
    return model.load(path)


def get_agent(bundle: dict = Depends(get_bundle)):
    return FlockAgent(bundle)


def _weeks(flock: Flock):
    weeks = [w.model_dump() for w in flock.weeks]
    # a missing deaths value is worked out from the drop in hens, but only
    # when the whole column is missing - a half-filled column would mix the two
    if any(w["deaths"] is None for w in weeks):
        for w in weeks:
            w.pop("deaths")
    return weeks


def _run(call):
    try:
        return call()
    except ValueError as err:  # records a forecast can't be built from
        raise HTTPException(422, str(err))


@app.get("/", include_in_schema=False)
def web_app():
    return FileResponse(WEB_DIR / "index.html")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/model")
def model_info(bundle: dict = Depends(get_bundle)):
    """How the loaded models were trained and how they scored on unseen flocks."""
    return {
        "n_flocks": bundle["n_flocks"],
        "n_weeks": bundle["n_weeks"],
        "features": bundle["features"],
        "sklearn_version": bundle["sklearn_version"],
        "data_source": DATA_SOURCE,
        "horizons": [
            {
                "horizon_weeks": h,
                "model": entry["model_name"],
                "n_forecasts": entry["n_rows"],
                "results": entry["results"],
            }
            for h, entry in sorted(bundle["horizons"].items())
        ],
    }


@app.get("/standard-curve")
def standard_curve(bundle: dict = Depends(get_bundle)):
    """The breed's target laying rate (% per day) by week of age."""
    return [{"age_weeks": a, "standard": v} for a, v in sorted(bundle["standard_curve"].items())]


@app.get("/sample-flock")
def sample_flock():
    """A real flock's first 16 weeks, so the web app has something to load."""
    return json.loads(SAMPLE_FLOCK.read_text(encoding="utf-8"))


@app.post("/forecast")
def forecast(flock: Flock, agent: FlockAgent = Depends(get_agent)):
    return {"flock_id": flock.flock_id, "forecasts": _run(lambda: agent.forecast(_weeks(flock)))}


@app.post("/flock/review")
def review(flock: Flock, agent: FlockAgent = Depends(get_agent)):
    return _run(lambda: agent.review(_weeks(flock), flock.flock_id))
