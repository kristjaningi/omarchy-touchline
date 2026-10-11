// node --test
process.env.TZ = "Europe/London"

const test = require("node:test")
const assert = require("node:assert")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")

// The module is a QML JavaScript library; minus its pragma it is plain script.
const source = fs.readFileSync(path.join(__dirname, "../Model.js"), "utf8")
const Model = vm.createContext({})
vm.runInContext(source.replace(/^\.pragma library$/m, ""), Model)

const fmt = (date, f) => f === "ddd"
  ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()]
  : `${date.getDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getMonth()]}`

function team(id, name, abbr, logo = `https://a.espncdn.com/i/teamlogos/soccer/500/${id}.png`) {
  return { id, shortDisplayName: name, abbreviation: abbr, logos: [{ href: logo }] }
}

function event({ id, date, state = "post", completed = state === "post", home, away, hs, as, league = "Premier League", extra = {} }) {
  const score = (v) => v === undefined ? undefined : { value: v, displayValue: String(v), ...extra }
  return {
    id, date, league: { shortName: league },
    competitions: [{
      venue: { fullName: "Emirates Stadium" },
      status: { displayClock: "63'", type: { state, completed, shortDetail: "FT" } },
      competitors: [
        { homeAway: "home", team: home, score: score(hs) },
        { homeAway: "away", team: away, score: score(as) },
      ],
    }],
  }
}

const ARS = team("359", "Arsenal", "ARS")
const LEE = team("357", "Leeds", "LEE")
const LIL = team("166", "Lille", "LILL")
const NFO = team("393", "Nott'm Forest", "NFO")

const results = JSON.stringify({ events: [
  event({ id: "2", date: "2026-10-10T11:30Z", home: ARS, away: LEE, hs: 2, as: 1 }),
  event({ id: "1", date: "2026-09-19T14:00Z", home: LEE, away: ARS, hs: 3, as: 0 }),
] })
const fixtures = JSON.stringify({ events: [
  event({ id: "3", date: "2026-10-13T19:00Z", state: "pre", home: ARS, away: LIL, league: "UEFA Champions League" }),
  event({ id: "4", date: "2026-10-18T15:30Z", state: "pre", home: NFO, away: ARS }),
] })
const NOW = Date.parse("2026-10-11T20:00Z")

test("parses, merges and picks the last result and next fixtures", () => {
  const all = Model.merge(Model.parseSchedule(results, "359"), Model.parseSchedule(fixtures, "359"))
  assert.deepStrictEqual(Array.from(all, (m) => m.id), ["1", "2", "3", "4"])

  const last = Model.lastResult(all)
  assert.strictEqual(last.id, "2")
  assert.strictEqual(last.result, "W")
  assert.strictEqual(last.them.name, "Leeds")
  assert.strictEqual(Model.scoreLine(last), "2 – 1")

  assert.strictEqual(Model.result(Model.side({ score: { value: 0 } }), Model.side({ score: { value: 3 } })), "L")
  assert.deepStrictEqual(Array.from(Model.form(all, 5)), ["L", "W"])

  const next = Model.upcoming(all, NOW, 3)
  assert.deepStrictEqual(Array.from(next, (m) => m.id), ["3", "4"])
  assert.strictEqual(next[1].home, false)
  assert.strictEqual(Model.barText(all, NOW, fmt), "Lille · Tue")
})

test("away fixtures are marked, distant ones get a date", () => {
  const all = Model.merge([], Model.parseSchedule(fixtures, "359")).slice(1)
  assert.strictEqual(Model.barText(all, NOW, fmt), "@NFO · 18 Oct")
})

test("a live match takes over the bar", () => {
  const live = JSON.stringify({ events: [event({ id: "3", date: "2026-10-13T19:00Z", state: "in", completed: false, home: ARS, away: LIL, hs: 1, as: 0 })] })
  const all = Model.merge(Model.parseSchedule(results, "359"), Model.parseSchedule(live, "359"))
  assert.strictEqual(Model.barText(all, NOW, fmt), "ARS 1–0 Lille 63'")
})

test("shootouts decide a level score, postponed matches are not results", () => {
  const pens = JSON.stringify({ events: [
    event({ id: "5", date: "2026-08-09T13:00Z", home: ARS, away: LEE, hs: 1, as: 1, extra: {} }),
    event({ id: "6", date: "2026-08-10T13:00Z", state: "post", completed: false, home: ARS, away: LEE }),
  ] })
  const parsed = JSON.parse(pens)
  parsed.events[0].competitions[0].competitors[0].score.shootoutScore = 5
  parsed.events[0].competitions[0].competitors[1].score.shootoutScore = 4
  const all = Model.parseSchedule(JSON.stringify(parsed), "359")
  assert.strictEqual(all[0].result, "W")
  assert.strictEqual(all[0].penalties, true)
  assert.strictEqual(all[1].postponed, true)
  assert.strictEqual(Model.lastResult(all).id, "5")
})

test("markup-shaped and oversized text is neutralised, foreign crests dropped", () => {
  const evil = team("357", "<img src=\"https://example.invalid/t\">\u202e" + "x".repeat(200), "<b>", "https://example.invalid/logo.png")
  const all = Model.parseSchedule(JSON.stringify({ events: [event({ id: "7", date: "2026-10-10T11:30Z", home: ARS, away: evil, hs: 1, as: 0 })] }), "359")
  const them = all[0].them
  assert.ok(them.name.length <= 28)
  assert.ok(!/[\u202e]/.test(them.name))
  assert.strictEqual(them.logo, "")
  assert.strictEqual(all[0].us.logo, "https://a.espncdn.com/i/teamlogos/soccer/500/359.png")
})

test("rejects garbage, foreign matches, and bad team ids", () => {
  assert.strictEqual(Model.parseSchedule("not json", "359"), null)
  assert.strictEqual(Model.parseSchedule("x".repeat(3 * 1024 * 1024), "359"), null)
  assert.deepStrictEqual(Array.from(Model.parseSchedule(JSON.stringify({ events: [event({ id: "8", date: "2026-10-10T11:30Z", home: LEE, away: NFO, hs: 1, as: 0 })] }), "359")), [])
  assert.strictEqual(Model.teamId("359; rm -rf ~"), "")
  assert.strictEqual(Model.teamId(" 359 "), "359")
  assert.strictEqual(Model.scheduleUrl("../x", true), "")
  assert.strictEqual(Model.scheduleUrl("", false), "")
  assert.strictEqual(Model.scheduleUrl("256", true), "https://site.api.espn.com/apis/site/v2/sports/soccer/all/teams/256/schedule?fixture=true")
})

test("competition tags, match links and the polling window", () => {
  assert.strictEqual(Model.competitionTag("UEFA Champions League"), "UCL")
  assert.strictEqual(Model.competitionTag("Emirates Cup"), "Emirates Cup")
  assert.strictEqual(Model.matchUrl({ id: "401879268" }), "https://www.espn.com/soccer/match/_/gameId/401879268")
  assert.strictEqual(Model.matchUrl({ id: "1;x" }), "")
  const all = Model.parseSchedule(fixtures, "359")
  assert.strictEqual(Model.isMatchWindow(all, NOW), false)
  assert.strictEqual(Model.isMatchWindow(all, Date.parse("2026-10-13T18:50Z")), true)
  assert.strictEqual(Model.isMatchWindow(all, Date.parse("2026-10-13T21:30Z")), true)
})

test("countdown to kick-off reads like a person would say it", () => {
  const kickoff = Date.parse("2026-10-13T19:00Z")
  const before = (ms) => Model.countdown(kickoff, kickoff - ms)
  assert.strictEqual(before(30 * 1000), "Kicking off")
  assert.strictEqual(before(-4 * 60 * 1000), "Kicking off")
  assert.strictEqual(before(-10 * 60 * 1000), "Under way")
  assert.strictEqual(before(60 * 1000 + 1), "1 minute away")
  assert.strictEqual(before(45 * 60 * 1000), "45 minutes away")
  assert.strictEqual(before(61 * 60 * 1000), "1 hour away")
  assert.strictEqual(before(7.5 * 3600 * 1000), "7 hours away")
  assert.strictEqual(Model.countdown(kickoff, NOW), "2 days away")
  assert.strictEqual(Model.countdown(Date.parse("2026-10-18T15:30Z"), NOW), "7 days away")
})

function withShootout(json, home, away, winner) {
  const parsed = JSON.parse(json)
  const [h, a] = parsed.events[0].competitions[0].competitors
  h.score.shootoutScore = home
  a.score.shootoutScore = away
  if (winner) (winner === "home" ? h : a).winner = true
  return JSON.stringify(parsed)
}

test("ESPN's winner flag beats the goals, and shootouts show their score", () => {
  // As ESPN really sent the 2026 Emirates Cup match: 2–3, Arsenal won 5–4 on pens.
  const odd = JSON.stringify({ events: [event({ id: "401881706", date: "2026-08-09T13:00Z", home: ARS, away: LEE, hs: 2, as: 3 })] })
  const m = Model.parseSchedule(withShootout(odd, 5, 4, "home"), "359")[0]
  assert.strictEqual(m.result, "W")
  assert.strictEqual(Model.resultText(m), "Win · 5–4 pens")

  const lost = JSON.stringify({ events: [event({ id: "9", date: "2026-08-09T13:00Z", home: LEE, away: ARS, hs: 1, as: 1 })] })
  const l = Model.parseSchedule(withShootout(lost, 4, 3, "home"), "359")[0]
  assert.strictEqual(l.result, "L")
  assert.strictEqual(Model.resultText(l), "Loss · 3–4 pens")

  const won = Model.parseSchedule(results, "359")[0]
  assert.strictEqual(Model.resultText(won), "Win")
})

test("non-numeric event ids are dropped and can't reach the merge map", () => {
  const evil = JSON.stringify({ events: [
    event({ id: "__proto__", date: "2026-10-10T11:30Z", home: ARS, away: LEE, hs: 1, as: 0 }),
    event({ id: "constructor", date: "2026-10-10T11:30Z", home: ARS, away: LEE, hs: 1, as: 0 }),
    event({ id: "12", date: "1970-01-01T00:00Z", home: ARS, away: LEE, hs: 1, as: 0 }),
    event({ id: "13", date: "2026-10-10T11:30Z", home: ARS, away: LEE, hs: 1, as: 0 }),
  ] })
  const parsed = Model.parseSchedule(evil, "359")
  assert.deepStrictEqual(Array.from(parsed, (m) => m.id), ["13"])
  assert.strictEqual(Model.merge(parsed, parsed).length, 1)
})

test("merge: final beats live beats scheduled, and fresher feeds win ties", () => {
  const sched = Model.parseSchedule(fixtures, "359", 1000)
  const liveOld = Model.parseSchedule(JSON.stringify({ events: [event({ id: "3", date: "2026-10-13T19:00Z", state: "in", completed: false, home: ARS, away: LIL, hs: 0, as: 0 })] }), "359", 2000)
  const liveNew = Model.parseSchedule(JSON.stringify({ events: [event({ id: "3", date: "2026-10-13T19:00Z", state: "in", completed: false, home: ARS, away: LIL, hs: 1, as: 0 })] }), "359", 3000)
  const postponed = Model.parseSchedule(JSON.stringify({ events: [event({ id: "3", date: "2026-10-13T19:00Z", state: "post", completed: false, home: ARS, away: LIL })] }), "359", 1500)
  const byId = (list) => list.find((m) => m.id === "3")

  assert.strictEqual(byId(Model.merge(sched, liveOld)).state, "in")
  // Order of feeds doesn't matter; the fresher live score wins.
  assert.strictEqual(byId(Model.merge(liveNew, liveOld)).us.score, 1)
  assert.strictEqual(byId(Model.merge(liveOld, liveNew)).us.score, 1)
  // A postponement is final even when an older-looking feed reports it.
  assert.strictEqual(byId(Model.merge(liveNew, postponed)).postponed, true)
})

test("a scoreboard copy keeps the competition and crests from the schedule", () => {
  const sched = Model.parseSchedule(fixtures, "359", 1000)
  const board = JSON.parse(JSON.stringify({ events: [event({ id: "3", date: "2026-10-13T19:00Z", state: "in", completed: false, home: team("359", "Arsenal", "ARS", ""), away: team("166", "Lille", "LILL", ""), hs: 2, as: 1 })] }))
  delete board.events[0].league
  board.events[0].competitions[0].competitors.forEach((c) => { c.score = String(c.score.value) })
  const merged = Model.merge(sched, Model.parseSchedule(JSON.stringify(board), "359", 5000)).find((m) => m.id === "3")
  assert.strictEqual(merged.state, "in")
  assert.strictEqual(merged.us.score, 2)
  assert.strictEqual(merged.competition, "UEFA Champions League")
  assert.strictEqual(merged.them.logo, "https://a.espncdn.com/i/teamlogos/soccer/500/166.png")
})

test("a match ESPN never finishes stops being live after four hours", () => {
  const stuck = Model.parseSchedule(JSON.stringify({ events: [event({ id: "3", date: "2026-10-13T19:00Z", state: "in", completed: false, home: ARS, away: LIL, hs: 1, as: 0 })] }), "359")
  const kickoff = Date.parse("2026-10-13T19:00Z")
  assert.ok(Model.liveMatch(stuck, kickoff + 2 * 3600 * 1000))
  assert.strictEqual(Model.liveMatch(stuck, kickoff + 5 * 3600 * 1000), null)
  assert.strictEqual(Model.isMatchWindow(stuck, kickoff + 5 * 3600 * 1000), false)
})

test("scoreboard url is built only from a valid league slug", () => {
  const m = Model.parseSchedule(JSON.stringify({ events: [{ ...event({ id: "3", date: "2026-10-13T19:00Z", state: "pre", home: ARS, away: LIL }), league: { shortName: "UCL", slug: "uefa.champions" } }] }), "359")[0]
  assert.strictEqual(Model.scoreboardUrl(m), "https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/scoreboard?dates=20261012-20261014")
  assert.strictEqual(Model.scoreboardUrl({ ...m, league: "../../x?y=1" }), "")
  assert.strictEqual(Model.validLeague("eng.league_cup"), true)
})

test("unconfirmed kick-offs count days, not hours", () => {
  const kickoff = Date.parse("2026-10-13T19:00Z")
  assert.strictEqual(Model.countdown(kickoff, kickoff - 3 * 3600 * 1000, true), "Today")
  assert.strictEqual(Model.countdown(kickoff, NOW, true), "2 days away")
  const tbc = JSON.parse(fixtures)
  tbc.events[0].timeValid = false
  assert.strictEqual(Model.parseSchedule(JSON.stringify(tbc), "359")[0].tbc, true)
})

test("day labels hold across midnight and the October clock change", () => {
  // Europe/London leaves BST at 02:00 on Sunday 25 October 2026.
  assert.strictEqual(Model.dayLabel(Date.parse("2026-10-12T00:01+01:00"), Date.parse("2026-10-11T23:59+01:00"), fmt), "Tomorrow")
  assert.strictEqual(Model.dayLabel(Date.parse("2026-10-26T00:30Z"), Date.parse("2026-10-24T23:30+01:00"), fmt), "Mon")
  assert.strictEqual(Model.countdown(Date.parse("2026-10-26T00:30Z"), Date.parse("2026-10-24T23:30+01:00")), "2 days away")
})

test("bar names: short club names, abbreviations when they don't fit", () => {
  assert.strictEqual(Model.barName({ name: "Bayern", abbr: "MUN" }), "Bayern")
  assert.strictEqual(Model.barName({ name: "Nottm Forest", abbr: "NFO" }), "NFO")
})

test("cleaning strips bidi isolates and never splits a surrogate pair", () => {
  assert.strictEqual(Model.clean("a\u2066b\u2069c\u061cd", 20), "a b c d")
  const s = Model.clean("x".repeat(26) + "\u{1F600}" + "yy", 28)
  assert.ok(!/[\ud800-\udbff]…$/.test(s))
})

test("team search: soccer teams only, ids and crests checked, leagues named", () => {
  const raw = JSON.stringify({ items: [
    { id: "359", type: "team", sport: "soccer", displayName: "Arsenal", abbreviation: "ARS", league: "eng.1", logos: [{ href: "https://a.espncdn.com/i/teamlogos/soccer/500/359.png" }] },
    { id: "19973", type: "team", sport: "soccer", displayName: "Arsenal", abbreviation: "ARS", league: "eng.w.1", logos: [] },
    { id: "2", type: "team", sport: "basketball", displayName: "Boston Celtics", league: "nba" },
    { id: "__proto__", type: "team", sport: "soccer", displayName: "Evil", league: "eng.1" },
    { id: "77", type: "team", sport: "soccer", displayName: "<img src=x>", league: "x.y", logos: [{ href: "https://example.invalid/a.png" }] },
    { id: "359", type: "team", sport: "soccer", displayName: "Arsenal again", league: "eng.1" },
    { id: "2635", type: "team", sport: "soccer", displayName: "Arsenal Sarandi", league: "arg.3" },
  ] })
  const hits = Model.parseTeamSearch(raw)
  assert.deepStrictEqual(Array.from(hits, (h) => h.id), ["359", "19973", "77", "2635"])
  assert.strictEqual(hits[0].league, "Premier League")
  assert.strictEqual(hits[1].league, "Women's Super League")
  assert.strictEqual(hits[2].logo, "")
  assert.strictEqual(hits[3].league, "Argentina")
  assert.strictEqual(Model.leagueName("uefa.wchampions"), "Europe · Women")
  assert.strictEqual(Model.leagueName("sco.challenge"), "Scotland")
  assert.strictEqual(Model.leagueName("eng.fa_qual"), "England")
  assert.strictEqual(Model.leagueName("xyz.1"), "XYZ")
  assert.strictEqual(Model.leagueName("../bad"), "")
  assert.deepStrictEqual(Array.from(Model.parseTeamSearch("nope")), [])
})

test("search url: trimmed, length-capped, encoded, and empty for tiny queries", () => {
  assert.strictEqual(Model.searchUrl("a"), "")
  assert.strictEqual(Model.searchUrl("  Bayern München  "),
    "https://site.web.api.espn.com/apis/common/v3/search?type=team&sport=soccer&limit=8&query=Bayern%20M%C3%BCnchen")
  assert.ok(Model.searchUrl("x&y=1#" + "z".repeat(100)).endsWith("query=x%26y%3D1%23" + "z".repeat(34)))
})

test("saved team file: round-trips, and rejects anything odd", () => {
  const saved = Model.parseSavedTeam(Model.savedTeamText("256", "Celtic"))
  assert.strictEqual(saved.id, "256")
  assert.strictEqual(saved.name, "Celtic")
  assert.strictEqual(Model.parseSavedTeam('{"teamId":"1;rm","teamName":"x"}').id, "")
  assert.strictEqual(Model.parseSavedTeam('{"teamId":"1;rm","teamName":"x"}').name, "")
  assert.strictEqual(Model.parseSavedTeam("not json").id, "")
  assert.strictEqual(Model.parseSavedTeam("").id, "")
  assert.strictEqual(Model.parseSavedTeam("[1,2]").id, "")
})
