from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from ninja import Schema
from pydantic import EmailStr, Field


class RegisterIn(Schema):
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    phone: str = Field(min_length=10, max_length=20)
    password: str = Field(min_length=8)


class LoginIn(Schema):
    email: EmailStr
    password: str


class Features(Schema):
    routine: bool
    open_gym: bool
    classes: bool
    access: bool
    coach: bool
    admin: bool
    self_routine: bool = False
    owner: bool = False


class MembershipBrief(Schema):
    plan_name: str
    status: str  # active | expiring | grace | expired | paused | pending
    start_date: date
    end_date: date
    days_left: int | None
    blocked_on: date | None = None
    sessions_per_week: int


class MeOut(Schema):
    id: int
    email: str
    full_name: str
    phone: str
    avatar_url: str | None
    role: str
    has_password: bool = True
    status: str
    goal: str
    birth_date: date | None = None
    sex: Literal["f", "m", ""] = ""
    height_cm: Decimal | None
    target_weight_kg: Decimal | None
    greeting: Literal["a", "o", "x"]
    theme: Literal["light", "dark"]
    show_in_podium: bool
    share_achievements: bool
    features: Features
    membership: MembershipBrief | None


class MePatch(Schema):
    full_name: str | None = Field(None, min_length=2, max_length=120)
    phone: str | None = None
    goal: str | None = None
    birth_date: date | None = None
    sex: Literal["f", "m", ""] | None = None
    height_cm: Decimal | None = Field(None, ge=80, le=250)
    target_weight_kg: Decimal | None = None
    greeting: Literal["a", "o", "x"] | None = None
    theme: Literal["light", "dark"] | None = None
    show_in_podium: bool | None = None
    share_achievements: bool | None = None


class AnnouncementOut(Schema):
    id: int
    title: str
    body: str
    pinned: bool
    publish_at: datetime


class SessionBrief(Schema):
    booking_id: int
    name: str
    type: str
    start_at: datetime
    end_at: datetime


class BirthdayOut(Schema):
    id: int
    first_name: str
    avatar_url: str | None
    is_me: bool


class HomeOut(Schema):
    greeting: str
    first_name: str
    membership: MembershipBrief | None
    checked_in_today: bool
    today_booking: SessionBrief | None
    missing_days_week: int
    week_checkins: list[bool]  # lunes..domingo
    today_workout: dict | None
    announcements: list[AnnouncementOut]
    birthdays: list["BirthdayOut"]
    whatsapp: str
    water: dict | None = None  # {ml, goal_ml}
    measures_due_days: int | None = None  # días sin registrar peso/medidas (≥ 30)
    measures_never: bool = False  # nunca ha registrado peso ni medidas
    streak_stars: list[dict] = []  # quién cumplió 1 mes (o más) de racha en los últimos días


# ----- Coach -----

class MemberRow(Schema):
    id: int
    full_name: str
    email: str
    phone: str
    avatar_url: str | None = None
    role: str = "member"
    status: str  # pending/active/blocked del perfil
    membership_status: str
    plan_name: str | None
    end_date: date | None
    last_checkin: date | None


class MemberDetail(MemberRow):
    coach_notes: str
    goal: str
    sessions_per_week: int | None
    membership_id: int | None
    start_date: date | None = None
    has_password: bool = True
    needs_access_link: bool = False
    uses_google: bool = False
    includes_routine: bool = False  # Plan Clases: sin rutina personalizada
    self_routine: bool = False  # la cuenta principal le deja armar su propia rutina
    payments: list[dict]
    recent_checkins: list[datetime]


class MemberPatch(Schema):
    coach_notes: str | None = None
    sessions_per_week: int | None = Field(None, ge=1, le=7)
    status: Literal["active", "blocked"] | None = None
    role: Literal["member", "coach", "admin"] | None = None
    self_routine: bool | None = None  # solo la cuenta principal


class DashboardOut(Schema):
    checkins_today: list[dict]
    expiring: list[MemberRow]
    expired: list[MemberRow]
    requests: list[dict]
    sessions_today: list[dict]
