// 設定用定数

const NOTIFICATION_HOUR = 8; // 通知する時間（24時間表記）
const WEEKLY_NOTIFICATION_DAY = 1; // 曜日番号での月曜日（0:日曜, 1:月曜, ..., 6:土曜）

// DiscordのWebhook URLとGoogleカレンダーIDをスクリプトプロパティに設定しておくこと
const DISCORD_WEBHOOK_URL =
  PropertiesService.getScriptProperties().getProperty("DISCORD_WEBHOOK_URL");

const CALENDAR_ID =
  PropertiesService.getScriptProperties().getProperty("CALENDAR_ID");


class ExDate extends Date {
  toFormattedString() {
    return this.toLocaleString("ja-JP", {
      month: "short",
      day: "numeric",
      weekday: "short"
    })
  }
  omitTime() {
    this.setHours(0, 0, 0, 0);
    return this;
  }
  shiftDate(days = 1) {
    this.setDate(this.getDate() + days);
    return this;
  }
  toDate() {
    return new Date(this.getTime());
  }
  static isSameDay(day1, day2) {
    return day1.getFullYear() === day2.getFullYear()
      && day1.getMonth() === day2.getMonth()
      && day1.getDate() === day2.getDate();
  }
}

function refreshTrigger() {
  const allTriggers = ScriptApp.getProjectTriggers();
  allTriggers.filter(trigger => trigger.getHandlerFunction() === "main").forEach(trigger => {
    ScriptApp.deleteTrigger(trigger);
  })

  const now = new ExDate();

  const year = now.getFullYear();
  const month = now.getMonth();
  const date = now.getDate();
  const hour = NOTIFICATION_HOUR;

  const next = new ExDate(year, month, date, hour);

  if (now.getTime() >= next.getTime()) {
    next.shiftDate();
  }

  ScriptApp.newTrigger("main").timeBased().at(next.toDate()).create();
}

// Discordに通知
function notify(url, message) {
  UrlFetchApp.fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    payload: JSON.stringify({ content: message }),
  });
}

// 指定日の予定タイトルを取得
function getEventTitles(date) {
  const myCalendar = CalendarApp.getCalendarById(CALENDAR_ID);
  const events = myCalendar.getEventsForDay(date);
  const eventTitles = events.map(event => event.getTitle());

  return eventTitles;
}

// 通知メッセージを作成
function makeDailyNotificationMessage(eventTitles) {
  if (eventTitles.length === 0) return null;
  const eventListString = eventTitles.map(
    eventTitle => `- ${eventTitle}`
  ).join("\n");
  return `本日の予定はこちらです\n${eventListString}`
}

// 週の通知メッセージを作成
function makeWeeklyNotificationMessage(startAt) {
  const startDate = new ExDate(startAt.getTime()).omitTime();
  const endDate = new ExDate(startAt.getTime()).omitTime().shiftDate(7);

  const myCalendar = CalendarApp.getCalendarById(CALENDAR_ID);
  const events = myCalendar.getEvents(startDate, endDate);
  if (!events.length) return null;
  const dates = events
    .filter(event => {
      if (!event.isAllDayEvent()) return true;
      const start = new ExDate(event.getStartTime());
      const end = new ExDate(event.getEndTime()).shiftDate(-1);
      return ExDate.isSameDay(start, end);
    })
    .map(event => new ExDate(event.getStartTime()).omitTime().getTime());
  
  if (!dates.length) return null;

  const deduplicatedDates = [... new Set(dates)];
  const sortedDateStrings = deduplicatedDates.toSorted((a,b) => a - b).map(time => new ExDate(time).toFormattedString())
  const groupedEvents = Map.groupBy(events, (event) => new ExDate(event.getStartTime()).toFormattedString());

  const message = sortedDateStrings
    .map(dateString => dateString + "\n- " + groupedEvents.get(dateString).map(event => event.getTitle()).join("\n- "))
    .join("\n\n");

  return `今週の予定はこちらです\n\n${message}`;
}

// メイン関数
function main() {
  const now = new ExDate();
  // 月曜は週の予定を通知
  if (now.getDay() === WEEKLY_NOTIFICATION_DAY) {
    const message = makeWeeklyNotificationMessage(now);
    if (!message) return;
    notify(DISCORD_WEBHOOK_URL, message);
  } else {
    const message = makeDailyNotificationMessage(getEventTitles(now));
    if (!message) return;
    notify(DISCORD_WEBHOOK_URL, message);
  }
}
