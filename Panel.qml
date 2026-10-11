import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "Model.js" as Model

Panel {
  id: root
  moduleName: "kristjaningi.touchline"
  ipcTarget: "kristjaningi.touchline"
  manageIpc: false

  property var anchorItem: null
  property var hostWidget: null
  readonly property var barIdentity: hostWidget || root

  function open() {
    setCenterHoverRevealSuppressed(false)
    root.controller.show()
    root.refresh()
    if (!root.hasTeam) root.startPicking()
  }

  function openFromHotkey() {
    root.controller.show()
    root.refresh()
    if (!root.hasTeam) root.startPicking()
    Qt.callLater(function() {
      if (root.opened) setCenterHoverRevealSuppressed(true)
    })
  }

  function close() {
    setCenterHoverRevealSuppressed(false)
    if (root.picking) root.cancelPicking()
    root.controller.hide()
  }

  function toggle() {
    if (root.opened) root.close()
    else root.openFromHotkey()
  }

  function switchPanel(direction) {
    if (root.bar && typeof root.bar.switchPanelFrom === "function")
      return root.bar.switchPanelFrom(root.barIdentity, direction)
    return false
  }

  function setCenterHoverRevealSuppressed(value) {
    if (root.bar && typeof root.bar.setCenterHoverRevealSuppressed === "function")
      root.bar.setCenterHoverRevealSuppressed(value)
    else if (root.bar && "centerHoverRevealSuppressed" in root.bar)
      root.bar.centerHoverRevealSuppressed = value
  }

  // ---- Data. Each feed keeps its last good parse, so a failed fetch leaves
  //      what was showing in place.
  // The team: picked in the popup and saved to this widget's shell.json
  // entry. The local copy applies at once, ahead of the shell.json round trip.
  property string pickedTeamId: ""
  property string pickedTeamName: ""
  // The last pick, also kept in a state file: disabling the widget drops
  // its shell.json entry, and re-enabling it shouldn't forget the team.
  property var savedTeam: ({ id: "", name: "" })
  readonly property string statePath: (Quickshell.env("XDG_STATE_HOME") || (Quickshell.env("HOME") + "/.local/state"))
    + "/kristjaningi.touchline.json"
  readonly property string teamId: Model.teamId(pickedTeamId || setting("teamId", "") || savedTeam.id)
  readonly property bool hasTeam: teamId !== ""

  // Once shell.json carries the pick, it is the source of truth again, so a
  // later hand edit of teamId takes effect.
  onSettingsChanged: {
    if (pickedTeamId !== "" && Model.teamId(setting("teamId", "")) === pickedTeamId) {
      pickedTeamId = ""
      pickedTeamName = ""
    }
    syncSavedTeam()
  }

  // Keep the state file in step with a team set in shell.json, by hand or by
  // an older version of the plugin.
  property bool teamFileReady: false

  function syncSavedTeam() {
    if (!teamFileReady) return
    var id = Model.teamId(setting("teamId", ""))
    if (id === "" || id === savedTeam.id) return
    var name = Model.clean(setting("teamName", ""), 40)
    savedTeam = { id: id, name: name }
    teamFile.setText(Model.savedTeamText(id, name))
  }
  readonly property int fixtureCount: Math.max(1, Math.min(8, parseInt(setting("fixtures", 4), 10) || 4))
  readonly property bool autoRefresh: setting("autoRefresh", true) !== false

  property var resultsFeed: []
  property var fixturesFeed: []
  property var liveFeed: []
  property double now: Date.now()
  property bool loaded: false
  property double updatedAt: 0

  readonly property var matches: Model.merge(resultsFeed, fixturesFeed, liveFeed)
  readonly property var live: Model.liveMatch(matches, now)
  readonly property var last: Model.lastResult(matches)
  readonly property var recentForm: Model.form(matches, 5)
  readonly property var hero: live || last
  readonly property string teamName: matches.length > 0 ? matches[matches.length - 1].us.name
    : (pickedTeamName || Model.clean(setting("teamName", ""), 40) || savedTeam.name)
  readonly property string barLabel: hasTeam
    ? Model.barText(matches, now, function(d, f) { return Qt.formatDateTime(d, f) })
    : "Pick a team"
  readonly property var windowMatch: Model.windowMatch(matches, now)
  readonly property bool matchWindow: windowMatch !== null
  // The scoreboard only counts while it's in use; a failure from an earlier
  // match shouldn't mark today's fixtures offline.
  readonly property bool failing: resultsFetch.failed || fixturesFetch.failed
    || (matchWindow && liveFetch.failed)
  readonly property string statusText: !hasTeam ? ""
    : !loaded
    ? (failing ? "Couldn't reach ESPN. Trying again shortly." : "Fetching fixtures…")
    : (!hero && next.length === 0) ? "No fixtures scheduled"
    : failing ? "Offline · updated " + Qt.formatDateTime(new Date(updatedAt), "HH:mm")
    : ""

  // Reassigned only when the list really changes, so the rows (and their
  // hover state) survive the minute tick.
  property var next: []

  function updateNext() {
    var list = Model.upcoming(matches, now, fixtureCount)
    if (Model.idsOf(list) !== Model.idsOf(next)) next = list
  }

  onMatchesChanged: updateNext()
  onNowChanged: updateNext()
  onFixtureCountChanged: updateNext()

  // Deferred: teamId is first read inside other bindings, and clearing the
  // feeds mid-evaluation would loop back into them.
  onTeamIdChanged: Qt.callLater(resetTeam)

  function resetTeam() {
    resultsFeed = []
    fixturesFeed = []
    liveFeed = []
    loaded = false
    resultsFetch.restart()
    fixturesFetch.restart()
  }

  function refresh() {
    now = Date.now()
    resultsFetch.start()
    fixturesFetch.start()
    if (matchWindow) liveFetch.start()
  }

  function markLoaded() {
    loaded = true
    updatedAt = Date.now()
  }

  // A fixed green: themes don't reliably carry one (some map `green` to
  // their accent), and a win should read as a win whatever the theme.
  readonly property color winColor: "#30d158"

  function resultColor(r) {
    if (r === "W") return root.winColor
    if (r === "L") return Commons.Color.urgent
    return root.dim
  }

  function dayText(time) {
    return Model.dayLabel(time, root.now, function(d) { return Qt.formatDateTime(d, "ddd d MMM") })
  }

  function openMatch(m) {
    var url = Model.matchUrl(m)
    if (url !== "") Qt.openUrlExternally(url)
  }

  // ---- Team picker. Search is debounced and runs one request at a time;
  //      a query typed while one is in flight is fetched right after it.
  property bool picking: false
  readonly property bool showPicker: picking || !hasTeam
  property var searchResults: []
  property int searchIndex: 0
  property bool searching: false
  property string searchPendingUrl: ""
  property string searchActiveUrl: ""
  property string searchedQuery: ""
  property bool searchFailed: false

  function startPicking() {
    picking = true
    searchResults = []
    searchIndex = 0
    searchedQuery = ""
    searchFailed = false
    Qt.callLater(function() {
      teamField.text = ""
      teamField.forceActiveFocus()
    })
  }

  function cancelPicking() {
    picking = false
    searchDebounce.stop()
    searchResults = []
    Qt.callLater(function() { if (keyCatcher) keyCatcher.forceActiveFocus() })
  }

  function requestSearch() {
    var url = Model.searchUrl(teamField.text)
    searchPendingUrl = url
    if (url === "") {
      searchResults = []
      searchedQuery = ""
      searchFailed = false
      return
    }
    if (!searchProc.running) startSearch()
  }

  function startSearch() {
    searchActiveUrl = searchPendingUrl
    searching = true
    searchProc.command = ["curl", "-q", "-fsS", "--max-time", "8", "--max-filesize", "524288", "--proto", "=https", searchActiveUrl]
    searchProc.running = true
  }

  function pickTeam(team) {
    if (!team || Model.teamId(team.id) === "") return
    pickedTeamId = team.id
    pickedTeamName = team.name
    var entry = { id: root.moduleName }
    for (var key in root.settings) if (key !== "id") entry[key] = root.settings[key]
    entry.teamId = team.id
    entry.teamName = team.name
    if (root.bar && root.bar.shell && typeof root.bar.shell.updateEntryInline === "function")
      root.bar.shell.updateEntryInline(root.moduleName, entry)
    savedTeam = { id: team.id, name: team.name }
    teamFile.setText(Model.savedTeamText(team.id, team.name))
    cancelPicking()
  }

  FileView {
    id: teamFile
    path: root.statePath
    atomicWrites: true
    printErrors: false
    onLoaded: {
      root.savedTeam = Model.parseSavedTeam(text())
      root.teamFileReady = true
      root.syncSavedTeam()
    }
    onLoadFailed: {
      root.teamFileReady = true
      root.syncSavedTeam()
    }
  }

  Process {
    id: searchProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        root.searching = false
        if (root.searchActiveUrl !== root.searchPendingUrl) {
          if (root.searchPendingUrl !== "") Qt.callLater(root.startSearch)
          return
        }
        root.searchIndex = 0
        // curl -f leaves stdout empty on HTTP errors, timeouts and DNS
        // failures; that's ESPN unreachable, not a search with no hits.
        root.searchFailed = text === ""
        root.searchResults = root.showPicker && !root.searchFailed ? Model.parseTeamSearch(text) : []
        root.searchedQuery = root.searchFailed ? "" : Model.searchQuery(teamField.text)
      }
    }
  }

  Timer {
    id: searchDebounce
    interval: 300
    onTriggered: root.requestSearch()
  }

  // One ESPN request with its own retries. A response is used only if the
  // team and url it was made for are still current; a request that arrives
  // while one is in flight is queued behind it rather than dropped, so a
  // team change never waits out the refresh timer.
  component Feed: Item {
    id: feed
    property string url: ""
    property string team: ""
    property bool failed: false
    property int retries: 0
    property bool pending: false
    property string requestedUrl: ""
    property string requestedTeam: ""
    signal parsed(var list)

    function start() {
      retries = 0
      fetch()
    }

    function restart() {
      retries = 0
      failed = false
      if (proc.running) {
        pending = true
        proc.running = false
      } else fetch()
    }

    function fetch() {
      if (url === "") return
      if (proc.running) {
        pending = true
        return
      }
      requestedUrl = url
      requestedTeam = team
      proc.command = ["curl", "-q", "-fsS", "--max-time", "10", "--max-filesize", "2097152", "--proto", "=https", url]
      proc.running = true
    }

    function finish(text) {
      if (requestedUrl !== url || requestedTeam !== team) {
        pending = true
        return
      }
      var list = Model.parseSchedule(text, team, Date.now())
      if (list) {
        failed = false
        retries = 0
        parsed(list)
      } else if (retries < 3) {
        retries++
        retryTimer.restart()
      } else failed = true
    }

    Process {
      id: proc
      stdout: StdioCollector {
        waitForEnd: true
        onStreamFinished: feed.finish(text)
      }
      onExited: if (feed.pending) {
        feed.pending = false
        Qt.callLater(feed.fetch)
      }
    }

    Timer {
      id: retryTimer
      interval: 2500
      onTriggered: feed.fetch()
    }
  }

  Feed {
    id: resultsFetch
    team: root.teamId
    url: Model.scheduleUrl(root.teamId, false)
    onParsed: function(list) { root.resultsFeed = list; root.markLoaded() }
  }

  Feed {
    id: fixturesFetch
    team: root.teamId
    url: Model.scheduleUrl(root.teamId, true)
    onParsed: function(list) { root.fixturesFeed = list; root.markLoaded() }
  }

  // The live score: the schedule feeds don't reliably carry a match in play.
  Feed {
    id: liveFetch
    team: root.teamId
    url: Model.scoreboardUrl(root.windowMatch)
    onParsed: function(list) { root.liveFeed = list }
    // Fetch as soon as a feed reveals the window, not on the next refresh tick.
    onUrlChanged: if (url !== "") start()
  }

  // Every minute around kick-off; every 30 minutes otherwise, or every 5
  // while nothing has loaded or the last round failed. With auto refresh
  // off it fetches at startup, on opening the popup, and on middle click.
  Timer {
    interval: root.matchWindow ? 60 * 1000 : (root.loaded && !root.failing ? 30 * 60 * 1000 : 5 * 60 * 1000)
    running: root.autoRefresh
    repeat: true
    triggeredOnStart: true
    onTriggered: root.refresh()
  }

  Component.onCompleted: if (!root.autoRefresh) Qt.callLater(root.refresh)

  // Keeps "Today"/"Tomorrow", the countdown and the bar label current
  // between fetches.
  Timer {
    interval: 60 * 1000
    running: true
    repeat: true
    onTriggered: root.now = Date.now()
  }

  ShellIpc {
    target: root.ipcTarget

    function open(): void { root.openFromHotkey() }
    function close(): void { root.close() }
    function show(): void { root.openFromHotkey() }
    function hide(): void { root.close() }
    function toggle(): void { root.toggle() }
    function pick(): void { root.openFromHotkey(); root.startPicking() }
    // One IPC handler serves every monitor's bar; refresh them all.
    function refresh(): void {
      if (root.hostWidget && typeof root.hostWidget.broadcast === "function") root.hostWidget.broadcast("refresh")
      else root.refresh()
    }
  }

  readonly property color fg: root.bar ? root.bar.foreground : Commons.Color.foreground
  readonly property color dim: Qt.darker(fg, 1.5)
  readonly property string fontFamily: root.bar ? root.bar.fontFamily : Style.font.family

  component Label: Text {
    textFormat: Text.PlainText
    color: root.fg
    font.family: root.fontFamily
    font.pixelSize: Style.font.body
    elide: Text.ElideRight
  }

  component Caps: Label {
    color: root.dim
    font.pixelSize: Style.font.caption
  }

  component Crest: Item {
    property string source: ""
    property string fallback: ""
    property real size: Style.space(20)
    width: size
    height: size

    Image {
      id: crestImage
      anchors.fill: parent
      source: parent.source
      sourceSize.width: parent.size * 2
      sourceSize.height: parent.size * 2
      fillMode: Image.PreserveAspectFit
      asynchronous: true
      smooth: true
      mipmap: true
    }

    Label {
      visible: crestImage.status !== Image.Ready
      anchors.centerIn: parent
      text: parent.fallback.slice(0, 3)
      color: root.dim
      font.pixelSize: Math.max(Style.font.caption, parent.size * 0.32)
    }
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    centerOnBar: true
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(400))
    contentHeight: panel.fittedContentHeight(column.implicitHeight)

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      blocked: root.showPicker
      onReturnRequested: root.startPicking()
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }

      Flickable {
        id: scroller
        anchors.fill: parent
        contentWidth: width
        contentHeight: column.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        interactive: contentHeight > height

      Column {
        id: column
        width: scroller.width
        spacing: Style.space(16)

        // ---- Header: team name, recent form.
        Item {
          width: parent.width
          height: Math.max(title.implicitHeight, formRow.implicitHeight)

          Row {
            id: title
            anchors.left: parent.left
            anchors.leftMargin: Style.space(4)
            anchors.right: formRow.left
            anchors.rightMargin: Style.space(12)
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(8)

            Label {
              id: titleText
              width: Math.max(0, Math.min(implicitWidth, parent.width - chevron.implicitWidth - parent.spacing))
              text: root.showPicker ? (root.hasTeam ? "Change team" : "Pick your team") : (root.teamName || "Your team")
              font.pixelSize: Style.font.title
              font.weight: Font.DemiBold
            }

            // Tells you the name is the way to change team.
            Label {
              id: chevron
              visible: root.hasTeam
              anchors.verticalCenter: titleText.verticalCenter
              text: root.picking ? "\uf077" : "\uf078"
              color: titleArea.containsMouse ? root.fg : root.dim
              font.pixelSize: Style.font.caption
            }
          }

          MouseArea {
            id: titleArea
            enabled: root.hasTeam
            x: title.x
            y: title.y
            width: titleText.width + title.spacing + chevron.implicitWidth
            height: title.height
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: root.picking ? root.cancelPicking() : root.startPicking()
          }

          Row {
            id: formRow
            visible: !root.showPicker
            anchors.right: parent.right
            anchors.rightMargin: Style.space(4)
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(5)

            Repeater {
              model: root.recentForm

              Rectangle {
                required property var modelData
                width: Style.space(16)
                height: Style.space(16)
                radius: width / 2
                color: "transparent"
                border.width: 1
                border.color: root.resultColor(modelData)

                Label {
                  anchors.centerIn: parent
                  text: parent.modelData
                  color: root.resultColor(parent.modelData)
                  font.pixelSize: Style.font.caption
                  font.weight: Font.DemiBold
                }
              }
            }
          }
        }

        // ---- Team picker: a search field and up to eight matching teams.
        Column {
          visible: root.showPicker
          width: parent.width
          spacing: Style.space(8)

          TextField {
            id: teamField
            width: parent.width
            placeholderText: "Search for a club or national team"
            foreground: root.fg
            font.family: root.fontFamily

            onTextChanged: if (root.showPicker) searchDebounce.restart()

            Keys.onPressed: function(event) {
              if (event.key === Qt.Key_Escape) {
                if (root.hasTeam) root.cancelPicking()
                else root.close()
                event.accepted = true
              } else if (event.key === Qt.Key_Down) {
                if (root.searchIndex < root.searchResults.length - 1) root.searchIndex++
                event.accepted = true
              } else if (event.key === Qt.Key_Up) {
                if (root.searchIndex > 0) root.searchIndex--
                event.accepted = true
              } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
                root.pickTeam(root.searchResults[root.searchIndex])
                event.accepted = true
              }
            }
          }

          Repeater {
            model: root.searchResults

            Rectangle {
              id: hit
              required property var modelData
              required property int index
              width: parent.width
              height: Style.space(36)
              radius: Style.cornerRadius
              color: index === root.searchIndex ? Style.hoverFillFor(root.fg, Commons.Color.accent) : "transparent"

              Crest {
                id: hitCrest
                anchors.left: parent.left
                anchors.leftMargin: Style.space(8)
                anchors.verticalCenter: parent.verticalCenter
                size: Style.space(20)
                source: hit.modelData.logo
                fallback: hit.modelData.abbr
              }

              Label {
                anchors.left: hitCrest.right
                anchors.leftMargin: Style.space(10)
                anchors.right: hitLeague.left
                anchors.rightMargin: Style.space(8)
                anchors.verticalCenter: parent.verticalCenter
                text: hit.modelData.name
                font.pixelSize: Style.font.subtitle
                font.weight: Font.DemiBold
              }

              Caps {
                id: hitLeague
                anchors.right: parent.right
                anchors.rightMargin: Style.space(8)
                anchors.verticalCenter: parent.verticalCenter
                width: Math.min(implicitWidth, Style.space(150))
                horizontalAlignment: Text.AlignRight
                text: hit.modelData.league
              }

              MouseArea {
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onPositionChanged: root.searchIndex = hit.index
                onClicked: root.pickTeam(hit.modelData)
              }
            }
          }

          Label {
            visible: text !== ""
            width: parent.width
            leftPadding: Style.space(4)
            text: root.searching ? "Searching…"
              : root.searchFailed ? "Couldn't reach ESPN. Try again shortly."
              : (root.searchedQuery !== "" && root.searchResults.length === 0) ? "No teams found"
              : root.searchResults.length === 0 ? "Type a few letters of your team's name" : ""
            color: root.dim
            font.pixelSize: Style.font.bodySmall
          }
        }

        // ---- Hero: the live match, else the latest result.
        Item {
          visible: !root.showPicker && !!root.hero
          width: parent.width
          height: heroColumn.implicitHeight

          Column {
            id: heroColumn
            width: parent.width
            spacing: Style.space(10)

            Caps {
              anchors.horizontalCenter: parent.horizontalCenter
              text: !root.hero ? "" : root.live
                ? "Live" + (root.live.clock ? " · " + root.live.clock : "") + " · " + root.live.competition
                : root.hero.competition + " · " + root.dayText(root.hero.time)
              color: root.live ? Commons.Color.urgent : root.dim
            }

            Item {
              width: parent.width
              height: Math.max(homeSide.implicitHeight, score.implicitHeight)

              Column {
                id: homeSide
                anchors.left: parent.left
                anchors.right: score.left
                anchors.rightMargin: Style.space(8)
                anchors.verticalCenter: parent.verticalCenter
                spacing: Style.space(6)
                readonly property var team: root.hero ? (root.hero.home ? root.hero.us : root.hero.them) : null

                Crest {
                  anchors.horizontalCenter: parent.horizontalCenter
                  size: Style.space(40)
                  source: homeSide.team ? homeSide.team.logo : ""
                  fallback: homeSide.team ? homeSide.team.abbr : ""
                }
                Label {
                  width: parent.width
                  horizontalAlignment: Text.AlignHCenter
                  text: homeSide.team ? homeSide.team.name : ""
                  font.pixelSize: Style.font.subtitle
                  font.weight: Font.DemiBold
                }
              }

              Column {
                id: score
                anchors.centerIn: parent
                spacing: Style.space(4)

                Label {
                  anchors.horizontalCenter: parent.horizontalCenter
                  text: Model.scoreLine(root.hero) || "–"
                  font.pixelSize: Style.font.displayLarge
                  font.weight: Font.DemiBold
                }

                Label {
                  anchors.horizontalCenter: parent.horizontalCenter
                  visible: !root.live && text !== ""
                  text: Model.resultText(root.hero)
                  color: root.resultColor(root.hero ? root.hero.result : "")
                  font.pixelSize: Style.font.caption
                  font.weight: Font.DemiBold
                }
              }

              Column {
                id: awaySide
                anchors.right: parent.right
                anchors.left: score.right
                anchors.leftMargin: Style.space(8)
                anchors.verticalCenter: parent.verticalCenter
                spacing: Style.space(6)
                readonly property var team: root.hero ? (root.hero.home ? root.hero.them : root.hero.us) : null

                Crest {
                  anchors.horizontalCenter: parent.horizontalCenter
                  size: Style.space(40)
                  source: awaySide.team ? awaySide.team.logo : ""
                  fallback: awaySide.team ? awaySide.team.abbr : ""
                }
                Label {
                  width: parent.width
                  horizontalAlignment: Text.AlignHCenter
                  text: awaySide.team ? awaySide.team.name : ""
                  font.pixelSize: Style.font.subtitle
                  font.weight: Font.DemiBold
                }
              }

              MouseArea {
                anchors.fill: parent
                cursorShape: Qt.PointingHandCursor
                onClicked: root.openMatch(root.hero)
              }
            }
          }
        }

        Label {
          visible: !root.showPicker && text !== ""
          width: parent.width
          horizontalAlignment: Text.AlignHCenter
          text: root.statusText
          color: root.dim
          font.pixelSize: Style.font.bodySmall
          font.italic: true
        }

        Rectangle {
          visible: !root.showPicker && root.next.length > 0
          width: parent.width
          height: Style.spacing.hairline
          color: root.fg
          opacity: 0.12
        }

        // ---- Upcoming fixtures.
        Column {
          visible: !root.showPicker && root.next.length > 0
          width: parent.width
          spacing: Style.space(2)

          Item {
            width: parent.width
            height: nextHeader.implicitHeight + Style.space(6)

            Caps {
              id: nextHeader
              anchors.left: parent.left
              anchors.leftMargin: Style.space(4)
              text: "Next"
              color: root.fg
              font.pixelSize: Style.font.subtitle
              font.weight: Font.DemiBold
            }

            Caps {
              anchors.right: parent.right
              anchors.rightMargin: Style.space(8)
              anchors.baseline: nextHeader.baseline
              text: root.next.length > 0 ? Model.countdown(root.next[0].time, root.now, root.next[0].tbc) : ""
              color: Commons.Color.accent
              font.pixelSize: Style.font.caption
            }
          }

          Repeater {
            model: root.next

            Rectangle {
              id: fixture
              required property var modelData
              required property int index
              width: parent.width
              height: Style.space(36)
              radius: Style.cornerRadius
              color: rowArea.containsMouse ? Style.hoverFillFor(root.fg, Commons.Color.accent) : "transparent"

              Column {
                id: when
                anchors.left: parent.left
                anchors.leftMargin: Style.space(8)
                anchors.verticalCenter: parent.verticalCenter
                width: Style.space(92)
                spacing: Style.space(1)

                Label {
                  text: root.dayText(fixture.modelData.time)
                  font.pixelSize: Style.font.subtitle
                  font.weight: Font.DemiBold
                }
                Label {
                  text: fixture.modelData.tbc ? "TBC" : Qt.formatDateTime(new Date(fixture.modelData.time), "HH:mm")
                  color: root.dim
                  font.pixelSize: Style.font.caption
                }
              }

              Crest {
                id: crest
                anchors.left: when.right
                anchors.verticalCenter: parent.verticalCenter
                size: Style.space(20)
                source: fixture.modelData.them.logo
                fallback: fixture.modelData.them.abbr
              }

              Row {
                anchors.left: crest.right
                anchors.leftMargin: Style.space(10)
                anchors.right: tag.left
                anchors.rightMargin: Style.space(8)
                anchors.verticalCenter: parent.verticalCenter
                spacing: Style.space(6)

                Label {
                  id: opponentName
                  width: Math.max(0, Math.min(implicitWidth, parent.width - venueMark.implicitWidth - parent.spacing))
                  text: fixture.modelData.them.name
                  font.pixelSize: Style.font.subtitle
                  font.weight: Font.DemiBold
                }

                Label {
                  id: venueMark
                  anchors.baseline: opponentName.baseline
                  text: fixture.modelData.home ? "(H)" : "(A)"
                  color: root.dim
                  font.pixelSize: Style.font.bodySmall
                }
              }

              Caps {
                id: tag
                anchors.right: parent.right
                anchors.rightMargin: Style.space(8)
                anchors.verticalCenter: parent.verticalCenter
                width: Math.min(implicitWidth, Style.space(84))
                horizontalAlignment: Text.AlignRight
                text: Model.competitionTag(fixture.modelData.competition)
              }

              MouseArea {
                id: rowArea
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: root.openMatch(fixture.modelData)
              }
            }
          }
        }
      }
      }
    }
  }
}
