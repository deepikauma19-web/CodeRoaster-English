"""Reports filed against publicly shared roasts."""

from __future__ import annotations

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import TimestampMixin


class RoastReport(TimestampMixin, Base):
    """One report of a public roast. A reporter (identified only by a salted IP hash)
    can report a given roast once."""

    __tablename__ = "roast_reports"
    __table_args__ = (
        UniqueConstraint("roast_id", "reporter_hash", name="uq_report_roast_reporter"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    roast_id: Mapped[int] = mapped_column(
        ForeignKey("roasts.id", ondelete="CASCADE"), index=True, nullable=False
    )
    reason: Mapped[str] = mapped_column(String(30), nullable=False)
    details: Mapped[str | None] = mapped_column(String(500), nullable=True)
    reporter_hash: Mapped[str] = mapped_column(String(64), nullable=False)

    def __repr__(self) -> str:
        return f"<RoastReport id={self.id} roast_id={self.roast_id} reason={self.reason}>"
