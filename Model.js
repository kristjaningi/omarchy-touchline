.pragma library

// A football team's fixtures and results out of ESPN's public site API. Every request
// is keyless and fixed to site.api.espn.com: the team schedule (played
// matches, every competition), the same schedule with fixture=true (matches
// still to come), and around kick-off the competition's scoreboard, which is
// where ESPN keeps the live score. Everything read back is untrusted, so it
// is bounded, stripped of control and bidi characters and only ever
// displayed as plain text.

var MAX_RESPONSE_CHARS = 2 * 1024 * 1024
var MAX_EVENTS = 120
var LOGO_PREFIX = "https://a.espncdn.com/i/teamlogos/"
var HOUR = 3600 * 1000
// Past this a match ESPN still calls live is treated as stale: 90 minutes,
// extra time, penalties and stoppages fit comfortably inside it.
var LIVE_MAX_AGE = 4 * HOUR
var EARLIEST = Date.UTC(2000, 0, 1)
var LATEST = Date.UTC(2100, 0, 1)

// An ESPN team id is digits; anything else means no team is picked yet.
function teamId(value) {
  var id = String(value === undefined || value === null ? "" : value).trim()
  return /^[0-9]{1,8}$/.test(id) ? id : ""
}

function scheduleUrl(id, fixtures) {
  var team = teamId(id)
  if (team === "") return ""
  return "https://site.api.espn.com/apis/site/v2/sports/soccer/all/teams/"
    + team + "/schedule" + (fixtures ? "?fixture=true" : "")
}

// ---- Team search, for picking a team by name.

var MAX_QUERY = 40
var MAX_SEARCH_CHARS = 512 * 1024

function searchQuery(text) {
  var query = clean(text, MAX_QUERY + 1).slice(0, MAX_QUERY)
  // Half a surrogate pair would make encodeURIComponent throw.
  var last = query.charCodeAt(query.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? query.slice(0, -1) : query
}

function searchUrl(text) {
  var query = searchQuery(text)
  if (query.length < 2) return ""
  return "https://site.web.api.espn.com/apis/common/v3/search?type=team&sport=soccer&limit=8&query="
    + encodeURIComponent(query)
}

var LEAGUE_NAMES = {
  "eng.1": "Premier League", "eng.2": "Championship", "eng.3": "League One", "eng.4": "League Two",
  "eng.5": "National League", "eng.w.1": "Women's Super League",
  "sco.1": "Scottish Premiership", "sco.2": "Scottish Championship",
  "esp.1": "LaLiga", "esp.2": "LaLiga 2", "ger.1": "Bundesliga", "ger.2": "2. Bundesliga",
  "ita.1": "Serie A", "ita.2": "Serie B", "fra.1": "Ligue 1", "fra.2": "Ligue 2",
  "ned.1": "Eredivisie", "por.1": "Primeira Liga", "bel.1": "Belgian Pro League",
  "tur.1": "Süper Lig", "gre.1": "Greek Super League", "aut.1": "Austrian Bundesliga",
  "sui.1": "Swiss Super League", "den.1": "Danish Superliga", "nor.1": "Eliteserien",
  "swe.1": "Allsvenskan", "isl.1": "Besta deild",
  "usa.1": "MLS", "usa.nwsl": "NWSL", "mex.1": "Liga MX", "bra.1": "Brasileirão",
  "arg.1": "Liga Profesional", "ksa.1": "Saudi Pro League", "jpn.1": "J1 League",
  "aus.1": "A-League", "club.friendly": "Club", "fifa.world": "International"
}

var COUNTRY_NAMES = {
  eng: "England", sco: "Scotland", wal: "Wales", nir: "Northern Ireland", irl: "Ireland",
  esp: "Spain", ger: "Germany", ita: "Italy", fra: "France", ned: "Netherlands",
  por: "Portugal", bel: "Belgium", tur: "Turkey", gre: "Greece", aut: "Austria",
  sui: "Switzerland", den: "Denmark", nor: "Norway", swe: "Sweden", isl: "Iceland",
  fin: "Finland", pol: "Poland", cze: "Czechia", cro: "Croatia", srb: "Serbia",
  rus: "Russia", ukr: "Ukraine", rou: "Romania", usa: "USA", can: "Canada",
  mex: "Mexico", bra: "Brazil", arg: "Argentina", uru: "Uruguay", col: "Colombia",
  chi: "Chile", jpn: "Japan", kor: "South Korea", chn: "China", aus: "Australia",
  ksa: "Saudi Arabia", uefa: "Europe", conmebol: "South America", concacaf: "North America",
  caf: "Africa", afc: "Asia", fifa: "International", club: "Club"
}

// A readable competition name for a search hit. Leagues off the list fall
// back to their country, so two teams of the same name can still be told
// apart: "Scotland" against "Europe · Women".
function leagueName(slug) {
  var key = String(slug || "")
  if (Object.prototype.hasOwnProperty.call(LEAGUE_NAMES, key)) return LEAGUE_NAMES[key]
  if (!validLeague(key)) return ""
  var prefix = key.split(".")[0]
  var place = Object.prototype.hasOwnProperty.call(COUNTRY_NAMES, prefix) ? COUNTRY_NAMES[prefix] : prefix.toUpperCase()
  var women = /(^|\.)w(\.|$)|\.w[a-z_]|women|nwsl/.test(key)
  return place + (women ? " · Women" : "")
}

// Search hits as { id, name, abbr, league, logo }: soccer teams only, ids
// digits only, everything else cleaned like match data.
function parseTeamSearch(raw) {
  var text = String(raw || "")
  if (text === "" || text.length > MAX_SEARCH_CHARS) return []
  var parsed
  try { parsed = JSON.parse(text) } catch (e) { return [] }
  var items = parsed && Array.isArray(parsed.items) ? parsed.items : []
  var out = [], seen = Object.create(null)
  for (var i = 0; i < items.length && out.length < 8; i++) {
    var hit = searchHit(items[i])
    if (hit && !seen[hit.id]) {
      seen[hit.id] = true
      out.push(hit)
    }
  }
  return out
}

// One search result, or null. Hostile values (an object whose toString isn't
// callable) can make String() throw; such an item is skipped, not the search.
function searchHit(item) {
  try {
    if (!item || item.type !== "team" || item.sport !== "soccer") return null
    var id = teamId(item.id)
    var name = clean(item.displayName || item.name, 40)
    if (id === "" || name === "") return null
    return {
      id: id,
      name: name,
      abbr: clean(item.abbreviation, 5).toUpperCase(),
      league: leagueName(item.league || item.defaultLeagueSlug),
      logo: logoUrl(item)
    }
  } catch (e) {
    return null
  }
}

function validLeague(slug) {
  return /^[a-z0-9]{1,16}(\.[a-z0-9_]{1,24}){0,2}$/.test(String(slug || ""))
}

function ymd(time) {
  var d = new Date(time)
  var pad = function(n) { return (n < 10 ? "0" : "") + n }
  return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate())
}

// The scoreboard for the match's competition, a day either side of kick-off
// so ESPN's own idea of the match date can't miss it.
function scoreboardUrl(m) {
  if (!m || !validLeague(m.league) || !isFinite(m.time)) return ""
  return "https://site.api.espn.com/apis/site/v2/sports/soccer/" + m.league
    + "/scoreboard?dates=" + ymd(m.time - 24 * HOUR) + "-" + ymd(m.time + 24 * HOUR)
}

function clean(value, max) {
  if (value === undefined || value === null) return ""
  var text = String(value)
    .replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, " ")
    .replace(/\s+/g, " ").trim()
  if (text.length <= max) return text
  text = text.slice(0, max - 1)
  // Don't leave half a surrogate pair behind.
  var last = text.charCodeAt(text.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) text = text.slice(0, -1)
  return text + "…"
}

// Crests load from ESPN's image CDN and nowhere else.
function logoUrl(team) {
  var logos = team && Array.isArray(team.logos) ? team.logos : []
  for (var i = 0; i < logos.length && i < 4; i++) {
    var href = logos[i] && typeof logos[i].href === "string" ? logos[i].href : ""
    if (href.length < 200 && href.indexOf(LOGO_PREFIX) === 0 && /^[A-Za-z0-9:\/._-]+$/.test(href)) return href
  }
  return ""
}

// The schedule endpoint gives {value, displayValue}; the scoreboard a string.
function scoreValue(score) {
  if (score === undefined || score === null) return null
  var raw = typeof score === "object" ? (score.value !== undefined ? score.value : score.displayValue) : score
  var n = parseInt(raw, 10)
  return isFinite(n) && n >= 0 && n < 100 ? n : null
}

function shootoutValue(competitor) {
  if (!competitor) return null
  var raw = competitor.score && typeof competitor.score === "object" && competitor.score.shootoutScore !== undefined
    ? competitor.score.shootoutScore : competitor.shootoutScore
  if (raw === undefined || raw === null) return null
  var n = parseInt(raw, 10)
  return isFinite(n) && n >= 0 && n < 100 ? n : null
}

function side(competitor) {
  var team = competitor && competitor.team ? competitor.team : {}
  return {
    id: clean(team.id, 12),
    name: clean(team.shortDisplayName || team.displayName, 28),
    abbr: clean(team.abbreviation, 5).toUpperCase(),
    logo: logoUrl(team),
    score: scoreValue(competitor ? competitor.score : null),
    shootout: shootoutValue(competitor),
    winner: competitor ? competitor.winner === true : false
  }
}

// ESPN's winner flag is the authority when exactly one side carries it: it
// knows about shootouts and aggregate ties the goals alone don't show.
function result(us, them) {
  if (us.winner !== them.winner) return us.winner ? "W" : "L"
  if (us.score === null || them.score === null) return ""
  if (us.score > them.score) return "W"
  if (us.score < them.score) return "L"
  if (us.shootout !== null && them.shootout !== null && us.shootout !== them.shootout)
    return us.shootout > them.shootout ? "W" : "L"
  return "D"
}

function normalizeEvent(event, id, fetchedAt) {
  if (!event || typeof event !== "object") return null
  var eventId = String(event.id === undefined ? "" : event.id)
  if (!/^[0-9]{1,16}$/.test(eventId)) return null

  var competition = Array.isArray(event.competitions) ? event.competitions[0] : null
  if (!competition || !Array.isArray(competition.competitors) || competition.competitors.length !== 2) return null

  var time = Date.parse(String(event.date || competition.date || ""))
  if (!isFinite(time) || time < EARLIEST || time > LATEST) return null

  var a = competition.competitors[0], b = competition.competitors[1]
  var oursFirst = String(a && a.team ? a.team.id : a ? a.id : "") === id
  var oursSecond = String(b && b.team ? b.team.id : b ? b.id : "") === id
  if (oursFirst === oursSecond) return null

  var ourCompetitor = oursFirst ? a : b
  var us = side(ourCompetitor)
  var them = side(oursFirst ? b : a)

  var status = competition.status && competition.status.type ? competition.status.type : {}
  var state = status.state === "in" || status.state === "post" ? status.state : "pre"
  var completed = status.completed === true
  var league = event.league || {}
  var venue = competition.venue || {}
  var shootout = completed && us.shootout !== null && them.shootout !== null

  return {
    id: eventId,
    fetched: isFinite(fetchedAt) ? fetchedAt : 0,
    time: time,
    // ESPN flags kick-offs that aren't fixed yet (TV picks) as not valid.
    tbc: event.timeValid === false || competition.timeValid === false,
    state: state,
    completed: completed,
    // Postponed and cancelled matches arrive as "post" without completing.
    postponed: state === "post" && !completed,
    detail: clean(status.shortDetail || status.detail, 24),
    clock: clean(competition.status ? competition.status.displayClock : "", 8),
    competition: clean(league.shortName || league.name || league.abbreviation, 32),
    league: validLeague(league.slug) ? String(league.slug) : "",
    venue: clean(venue.fullName, 40),
    home: ourCompetitor.homeAway === "home",
    us: us,
    them: them,
    result: completed ? result(us, them) : "",
    penalties: shootout,
    shootoutLine: shootout ? us.shootout + "–" + them.shootout : ""
  }
}

function parseSchedule(raw, id, fetchedAt) {
  var text = String(raw || "")
  if (text === "" || text.length > MAX_RESPONSE_CHARS) return null
  var parsed
  try { parsed = JSON.parse(text) } catch (e) { return null }
  if (!parsed || !Array.isArray(parsed.events)) return null

  var wanted = teamId(id)
  var out = []
  for (var i = 0; i < parsed.events.length && i < MAX_EVENTS; i++) {
    // A malformed event is dropped rather than failing the whole feed.
    var match = null
    try { match = normalizeEvent(parsed.events[i], wanted, fetchedAt) } catch (e) {}
    if (match) out.push(match)
  }
  return out
}

// A finished match doesn't go back to live or scheduled, so a completed copy
// wins outright. A postponement wins over copies for the same kick-off, but a
// copy with a different kick-off is the match rescheduled, and the fresher of
// the two decides. Otherwise the most recently fetched copy wins, so a stale
// feed can't hold an old live score.
function newer(a, b) {
  if (a.completed !== b.completed) return a.completed ? a : b
  if (a.postponed !== b.postponed && a.time === b.time) return a.postponed ? a : b
  if (a.fetched !== b.fetched) return a.fetched > b.fetched ? a : b
  return rank(a) >= rank(b) ? a : b
}

function rank(m) {
  return m.completed ? 3 : (m.state === "post" ? 2 : (m.state === "in" ? 1 : 0))
}

// The scoreboard leaves out the competition name and some team details;
// keep them from whichever copy has them.
function fill(winner, other) {
  var keys = ["competition", "league", "venue"]
  var missing = false
  for (var i = 0; i < keys.length; i++) if (!winner[keys[i]] && other[keys[i]]) missing = true
  if (!missing && winner.us.logo && winner.them.logo) return winner
  var out = {}
  for (var k in winner) if (Object.prototype.hasOwnProperty.call(winner, k)) out[k] = winner[k]
  for (var j = 0; j < keys.length; j++) if (!out[keys[j]]) out[keys[j]] = other[keys[j]]
  if (!out.us.logo || !out.them.logo) {
    out.us = withLogo(out.us, other.us)
    out.them = withLogo(out.them, other.them)
  }
  return out
}

function withLogo(team, other) {
  if (team.logo || !other.logo) return team
  var out = {}
  for (var k in team) if (Object.prototype.hasOwnProperty.call(team, k)) out[k] = team[k]
  out.logo = other.logo
  return out
}

// One list from any number of feeds, duplicates resolved by newer(), sorted
// by kick-off. Ids are digits only, and the map has no prototype besides.
function merge() {
  var byId = Object.create(null)
  for (var f = 0; f < arguments.length; f++) {
    var feed = arguments[f] || []
    for (var i = 0; i < feed.length; i++) {
      var m = feed[i]
      var prev = byId[m.id]
      byId[m.id] = prev ? fill(newer(m, prev), newer(m, prev) === m ? prev : m) : m
    }
  }
  var list = Object.keys(byId).map(function(k) { return byId[k] })
  list.sort(function(x, y) { return x.time - y.time })
  return list
}

function isLive(m, now) {
  return m.state === "in" && now - m.time < LIVE_MAX_AGE
}

function liveMatch(matches, now) {
  for (var i = 0; i < matches.length; i++) if (isLive(matches[i], now)) return matches[i]
  return null
}

function lastResult(matches) {
  for (var i = matches.length - 1; i >= 0; i--) if (matches[i].completed) return matches[i]
  return null
}

function upcoming(matches, now, count) {
  var out = []
  for (var i = 0; i < matches.length && out.length < count; i++) {
    var m = matches[i]
    if (m.state === "pre" && m.time > now - 3 * HOUR) out.push(m)
  }
  return out
}

function idsOf(list) {
  return list.map(function(m) { return m.id + ":" + m.fetched }).join(",")
}

function form(matches, count) {
  var out = []
  for (var i = matches.length - 1; i >= 0 && out.length < count; i--)
    if (matches[i].completed && matches[i].result !== "") out.unshift(matches[i].result)
  return out
}

function scoreLine(m) {
  if (!m || m.us.score === null || m.them.score === null) return ""
  var home = m.home ? m.us : m.them
  var away = m.home ? m.them : m.us
  return home.score + " – " + away.score
}

// "Win", "Loss", "Draw"; a shootout adds its score, from our side.
function resultText(m) {
  if (!m || m.result === "") return ""
  var word = m.result === "W" ? "Win" : m.result === "L" ? "Loss" : "Draw"
  return m.penalties ? word + " · " + m.shootoutLine + " pens" : word
}

// "Today", "Tomorrow", else `format` (Qt.formatDateTime, passed in to keep
// this testable). Calendar days, so it holds across midnight and DST.
function dayLabel(time, now, format) {
  var diff = calendarDays(time, now)
  if (diff === 0) return "Today"
  if (diff === 1) return "Tomorrow"
  if (diff > 1 && diff < 7) return format(new Date(time), "ddd")
  return format(new Date(time), "d MMM")
}

function calendarDays(time, now) {
  var day = new Date(time), today = new Date(now)
  return Math.round((Date.UTC(day.getFullYear(), day.getMonth(), day.getDate())
    - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000)
}

// Short enough for the bar: the club's short name when it fits ("Lille",
// "Bayern"), else ESPN's abbreviation ("NFO"), which isn't always obvious
// (Bayern's is "MUN").
function barName(team) {
  return team.name && team.name.length <= 8 ? team.name : (team.abbr || team.name)
}

function barText(matches, now, format) {
  var live = liveMatch(matches, now)
  if (live) {
    var clock = live.clock && live.clock !== "0'" ? " " + live.clock : ""
    return live.us.abbr + " " + (live.us.score === null ? 0 : live.us.score) + "–"
      + (live.them.score === null ? 0 : live.them.score) + " " + barName(live.them) + clock
  }
  var next = upcoming(matches, now, 1)[0]
  if (next) return (next.home ? "" : "@") + barName(next.them) + " · " + dayLabel(next.time, now, format)
  var last = lastResult(matches)
  if (last) return last.result + " " + last.us.score + "–" + last.them.score + " " + barName(last.them)
  return ""
}

var COMPETITION_TAGS = {
  "Premier League": "PL",
  "English Premier League": "PL",
  "UEFA Champions League": "UCL",
  "Champions League": "UCL",
  "UEFA Europa League": "UEL",
  "Carabao Cup": "EFL Cup",
  "English Carabao Cup": "EFL Cup",
  "English FA Cup": "FA Cup",
  "Community Shield": "Shield",
  "UEFA Conference League": "UECL",
  "UEFA Europa Conference League": "UECL",
  "SPFL Premiership": "SPFL",
  "Scottish Premiership": "SPFL",
  "Spanish LaLiga": "LaLiga",
  "German Bundesliga": "Bundesliga",
  "Italian Serie A": "Serie A",
  "French Ligue 1": "Ligue 1",
  "Major League Soccer": "MLS",
  "Copa del Rey": "Copa",
  "DFB Pokal": "Pokal",
  "Club Friendly": "Friendly"
}

function competitionTag(name) {
  var key = String(name || "")
  return Object.prototype.hasOwnProperty.call(COMPETITION_TAGS, key) ? COMPETITION_TAGS[key] : key
}

// ESPN's match page. Ids are digits or nothing, so nothing else gets opened.
function matchUrl(m) {
  return m && /^[0-9]{1,16}$/.test(m.id) ? "https://www.espn.com/soccer/match/_/gameId/" + m.id : ""
}

// The match the minute-by-minute polling is for: one on now, or one due to
// kick off within 15 minutes (or that should have, by up to three hours, and
// the feed hasn't caught up).
function windowMatch(matches, now) {
  for (var i = 0; i < matches.length; i++) {
    var m = matches[i]
    if (isLive(m, now)) return m
    if (m.state === "pre" && m.time - now < 15 * 60 * 1000 && now - m.time < 3 * HOUR) return m
  }
  return null
}

function isMatchWindow(matches, now) {
  return windowMatch(matches, now) !== null
}

// "45 minutes away", "7 hours away", "5 days away"; calendar days past a
// day, so a Tuesday evening match seen on Sunday night is two days away.
// A kick-off still to be confirmed only gets day-level precision.
function countdown(time, now, tbc) {
  var ms = time - now
  if (tbc) {
    var d = calendarDays(time, now)
    return d <= 0 ? "Today" : d === 1 ? "Tomorrow" : plural(d, "day") + " away"
  }
  if (ms <= -5 * 60 * 1000) return "Under way"
  if (ms <= 60 * 1000) return "Kicking off"
  var minutes = Math.floor(ms / 60000)
  if (minutes < 60) return plural(minutes, "minute") + " away"
  var hours = Math.floor(minutes / 60)
  if (hours < 24) return plural(hours, "hour") + " away"
  return plural(calendarDays(time, now), "day") + " away"
}

function plural(n, unit) {
  return n + " " + unit + (n === 1 ? "" : "s")
}

// The team choice as kept in the state file, so it survives the widget
// being disabled and re-enabled (which drops its shell.json entry).
function parseSavedTeam(raw) {
  var text = String(raw || "")
  if (text === "" || text.length > 4096) return { id: "", name: "" }
  var parsed
  try { parsed = JSON.parse(text) } catch (e) { return { id: "", name: "" } }
  if (!parsed || typeof parsed !== "object") return { id: "", name: "" }
  var id = teamId(parsed.teamId)
  return { id: id, name: id === "" ? "" : clean(parsed.teamName, 40) }
}

function savedTeamText(id, name) {
  return JSON.stringify({ teamId: teamId(id), teamName: clean(name, 40) }, null, 2) + "\n"
}
