import QtQuick
import qs.Commons
import qs.Ui

// Ball plus the next opponent ("@NFO · Sat"), or the score while a match is
// on; "Pick a team" until one is chosen. Left click opens the popup, middle
// click refetches.
BarWidget {
  id: root
  moduleName: "kristjaningi.touchline"

  function injectPanel() {
    var target = panelLoader.item
    if (!target) return
    if ("bar" in target) target.bar = root.bar
    if ("settings" in target) target.settings = root.settings
    if ("anchorItem" in target) target.anchorItem = button
    if ("hostWidget" in target) target.hostWidget = root
  }

  function refresh() {
    if (panelLoader.item && panelLoader.item.refresh) panelLoader.item.refresh()
  }

  function toggle() {
    if (panelLoader.item && panelLoader.item.toggle) panelLoader.item.toggle()
  }

  // Shape contract for shell.summon/hide/toggle routing (Bar.findPanelWidget
  // requires open/close/opened on the bar-widget root).
  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false

  function open() {
    if (panelLoader.item && panelLoader.item.openFromHotkey) panelLoader.item.openFromHotkey()
  }

  function close() {
    if (panelLoader.item && panelLoader.item.close) panelLoader.item.close()
  }

  readonly property bool popoutSwitchClosing: panelLoader.item ? panelLoader.item.popoutSwitchClosing === true : false

  function closeForPopoutSwitch() {
    if (panelLoader.item) panelLoader.item.closeForPopoutSwitch()
  }

  readonly property string glyph: "" // nf-fa-futbol
  readonly property bool live: panelLoader.item ? panelLoader.item.live !== null : false
  readonly property string label: panelLoader.item ? panelLoader.item.barLabel : ""
  readonly property bool showLabel: !vertical && label !== "" && (live || setting("showLabel", true) !== false)

  // Match the full ball-and-fixture label; icon-only buttons keep the shell's
  // default compact mark because their labelWidth is zero.
  readonly property real openPanelIndicatorWidth: button.labelWidth

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  onBarChanged: injectPanel()
  onSettingsChanged: injectPanel()

  Loader {
    id: panelLoader
    active: true
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
    }
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.showLabel ? root.glyph + "  " + root.label : root.glyph
    active: root.live
    // A vertical bar has room for the ball only; the label moves to a tooltip.
    tooltipText: root.vertical ? root.label : ""

    onPressed: function(b) {
      if (b === Qt.MiddleButton) root.broadcast("refresh")
      else root.toggle()
    }
  }
}
