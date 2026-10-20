"""LLM prompt templates: an analysis prompt, and a roast prompt + one TONE block per intensity."""

from app.models.roast import RoastIntensity
from app.services.prompts import extra_spicy, medium, mild
from app.services.prompts.base import ANALYSIS_PROMPT, BASE_PROMPT, ROAST_PROMPT

TONES: dict[RoastIntensity, str] = {
    RoastIntensity.mild: mild.TONE,
    RoastIntensity.medium: medium.TONE,
    RoastIntensity.extra_spicy: extra_spicy.TONE,
}


def build_analysis_prompt() -> str:
    """System prompt for the scoring/tips step. Identical for every intensity."""
    return ANALYSIS_PROMPT


def build_system_prompt(intensity: RoastIntensity) -> str:
    """Roast prompt (guard, safety, roast rules) + the tone block for `intensity`."""
    return f"{ROAST_PROMPT}\n{TONES[RoastIntensity(intensity)]}"


__all__ = [
    "ANALYSIS_PROMPT",
    "BASE_PROMPT",
    "ROAST_PROMPT",
    "TONES",
    "build_analysis_prompt",
    "build_system_prompt",
]
