import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { DAILY_GOAL_SECONDS, addDays, streak } from "./practiceLog";

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];
const GOAL_MINUTES = DAILY_GOAL_SECONDS / 60;
/** How long today's star celebrates once the goal is met. */
const CELEBRATE_MS = 2400;
const minutes = (seconds: number) => Math.floor(seconds / 60);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function Star() {
  return (
    <svg className="practice-star" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.5l2.9 6 6.6.8-4.9 4.5 1.3 6.5L12 17l-5.9 3.3 1.3-6.5-4.9-4.5 6.6-.8z" />
    </svg>
  );
}

/** Today's progress toward the goal, as a ring around the date. */
function Ring({ seconds }: { seconds: number }) {
  const length = 2 * Math.PI * 15;
  const done = Math.min(seconds / DAILY_GOAL_SECONDS, 1);
  return (
    <svg className="practice-ring" viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r="15" />
      <circle
        className="practice-ring-done"
        cx="18"
        cy="18"
        r="15"
        strokeDasharray={length}
        strokeDashoffset={length * (1 - done)}
      />
    </svg>
  );
}

/**
 * This month's practice: a star on each day with at least the daily goal, a
 * dot on days with some practice, and a ring filling up for today. Today's
 * star pops when the goal is met while the studio is open.
 */
export const PracticeCalendar = memo(function PracticeCalendar({
  totals,
  today,
}: {
  /** Seconds practiced on each day, YYYY-MM-DD. */
  totals: ReadonlyMap<string, number>;
  today: string;
}) {
  const todaySeconds = totals.get(today) ?? 0;
  const [celebrating, setCelebrating] = useState(false);
  const before = useRef(todaySeconds);
  useEffect(() => {
    if (
      before.current < DAILY_GOAL_SECONDS &&
      todaySeconds >= DAILY_GOAL_SECONDS
    )
      setCelebrating(true);
    before.current = todaySeconds;
  }, [todaySeconds]);
  useEffect(() => {
    if (!celebrating) return;
    const timer = setTimeout(() => setCelebrating(false), CELEBRATE_MS);
    return () => clearTimeout(timer);
  }, [celebrating]);

  const [year, month] = today.split("-").map(Number);
  const first = new Date(year, month - 1, 1);
  const monthName = first.toLocaleDateString("en-US", { month: "long" });
  // Weeks start on Monday.
  const blanks = (first.getDay() + 6) % 7;
  const dates = Array.from(
    { length: new Date(year, month, 0).getDate() },
    (_, i) => addDays(`${today.slice(0, 8)}01`, i),
  );
  const run = streak(totals, today);
  const done = todaySeconds >= DAILY_GOAL_SECONDS;

  return (
    <section className="practice-calendar" aria-labelledby="practice-month">
      <div className="practice-calendar-head">
        <strong id="practice-month">{monthName}</strong>
        {run > 0 && (
          <span className="practice-streak">
            <Star />
            {run}-day streak
          </span>
        )}
      </div>
      <div className="practice-days" role="list">
        {WEEKDAYS.map((name, i) => (
          <span key={i} className="practice-weekday" aria-hidden="true">
            {name}
          </span>
        ))}
        {Array.from({ length: blanks }, (_, i) => (
          <span key={`blank-${i}`} aria-hidden="true" />
        ))}
        {dates.map((day) => {
          const seconds = totals.get(day) ?? 0;
          const date = Number(day.slice(8));
          const isToday = day === today;
          const met = seconds >= DAILY_GOAL_SECONDS;
          const state = met
            ? "done"
            : isToday
              ? "today"
              : day > today
                ? "future"
                : seconds > 0
                  ? "some"
                  : "";
          const label = `${monthName} ${date}${isToday ? ", today" : ""}: ${
            met
              ? `${plural(minutes(seconds), "minute")}, star earned`
              : isToday
                ? `${minutes(seconds)} of ${GOAL_MINUTES} minutes`
                : day > today
                  ? "coming up"
                  : seconds > 0
                    ? plural(minutes(seconds), "minute")
                    : "no practice"
          }`;
          return (
            <span
              key={day}
              role="listitem"
              aria-label={label}
              title={label}
              className={`practice-day ${state} ${isToday ? "is-today" : ""} ${
                isToday && celebrating ? "celebrate" : ""
              }`}
            >
              {met ? <Star /> : date}
              {isToday && !met && <Ring seconds={seconds} />}
              {isToday &&
                celebrating &&
                Array.from({ length: 8 }, (_, i) => (
                  <i
                    key={i}
                    className="practice-spark"
                    style={
                      {
                        "--angle": `${i * 45}deg`,
                      } as CSSProperties
                    }
                  />
                ))}
            </span>
          );
        })}
      </div>
      <p className="practice-today">
        {done
          ? "Today's star earned. Great job!"
          : todaySeconds > 0
            ? `Today: ${minutes(todaySeconds)} of ${GOAL_MINUTES} minutes`
            : `Play ${GOAL_MINUTES} minutes today to earn a star.`}
      </p>
      <p className="sr-only" role="status">
        {celebrating ? "Today's star earned!" : ""}
      </p>
    </section>
  );
});
