/* Gulel Gubbara presentation layer. The physics engine owns the canvas; this
   file only mirrors its events and wires accessible controls. */
(function () {
  'use strict';

  var api = window.GulelGame || {};
  var $ = function (selector, root) { return (root || document).querySelector(selector); };
  var $$ = function (selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); };
  var overlays = $$('.game-overlay');
  var lastState = { score: 0, highScore: 0, level: 1, shots: 0, popped: 0, target: 10, combo: 0, sound: true };

  function call(name) {
    if (typeof api[name] === 'function') api[name]();
  }

  function setText(name, value) {
    $$('[data-stat="' + name + '"]').forEach(function (node) { node.textContent = value == null ? 0 : value; });
  }

  function updateState(event) {
    var incoming = event && event.detail ? event.detail : {};
    Object.keys(incoming).forEach(function (key) { lastState[key] = incoming[key]; });
    ['score', 'highScore', 'level', 'shots', 'popped', 'target', 'combo'].forEach(function (key) { setText(key, lastState[key]); });

    var target = Math.max(1, Number(lastState.target) || 1);
    var popped = Math.max(0, Number(lastState.popped) || 0);
    var fill = Math.min(100, popped / target * 100);
    var bar = $('#progressFill');
    if (bar) bar.style.width = fill + '%';
    var progress = $('.progress-track');
    if (progress) { progress.setAttribute('aria-valuemax', target); progress.setAttribute('aria-valuenow', Math.min(target, popped)); }

    var soundButton = $('#soundButton');
    if (soundButton && typeof lastState.sound !== 'undefined') {
      soundButton.setAttribute('aria-pressed', String(!lastState.sound));
      soundButton.setAttribute('aria-label', lastState.sound ? 'Mute sound' : 'Turn sound on');
    }
  }

  function setOverlay(name, visible) {
    var overlay = $('[data-overlay="' + name + '"]');
    if (!overlay) return;
    overlay.hidden = !visible;
    overlay.classList.toggle('is-visible', visible);
  }

  function resultText(name, value) {
    $$('[data-result="' + name + '"]').forEach(function (node) { node.textContent = value == null ? 0 : value; });
  }

  function updateScreen(event) {
    var detail = event && event.detail ? event.detail : {};
    var screen = detail.screen || 'playing';
    ['score', 'level', 'highScore'].forEach(function (key) {
      if (detail[key] !== undefined) lastState[key] = detail[key];
      resultText(key, lastState[key]);
    });
    overlays.forEach(function (overlay) { overlay.hidden = true; overlay.classList.remove('is-visible'); });
    if (screen === 'playing') {
      var pause = $('#pauseButton');
      if (pause) { pause.innerHTML = '<span aria-hidden="true">Ⅱ</span> Pause'; pause.disabled = false; }
      return;
    }
    var name = screen === 'levelComplete' ? 'levelComplete' : screen;
    setOverlay(name, true);
    var pauseButton = $('#pauseButton');
    if (pauseButton && screen === 'paused') pauseButton.innerHTML = '<span aria-hidden="true">▶</span> Resume';
    if (pauseButton && (screen === 'gameOver' || screen === 'victory' || screen === 'levelComplete')) pauseButton.disabled = true;
  }

  function restart() { call('restart'); }

  function bind() {
    var start = $('#startButton');
    var resume = $('#resumeButton');
    var next = $('#nextLevelButton');
    var pause = $('#pauseButton');
    var restartButton = $('#restartButton');
    var sound = $('#soundButton');
    if (start) start.addEventListener('click', function () { call('start'); });
    if (resume) resume.addEventListener('click', function () { call('resume'); });
    if (next) next.addEventListener('click', function () { call('nextLevel'); });
    if (restartButton) restartButton.addEventListener('click', restart);
    $$('[data-action="restart"]').forEach(function (button) { button.addEventListener('click', restart); });
    if (pause) pause.addEventListener('click', function () {
      if (pause.innerText.toLowerCase().indexOf('resume') >= 0) call('resume'); else call('pause');
    });
    if (sound) sound.addEventListener('click', function () { call('toggleSound'); });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') call('pause');
      if ((event.key === 'r' || event.key === 'R') && !event.ctrlKey && !event.metaKey) restart();
    });
    window.addEventListener('gulel:state', updateState);
    window.addEventListener('gulel:screen', updateScreen);
    // Accept events from either side of the engine boundary; this keeps the
    // presentation layer compatible with engines that dispatch on document.
    document.addEventListener('gulel:state', updateState);
    document.addEventListener('gulel:screen', updateScreen);
    updateState({ detail: lastState });
    updateScreen({ detail: { screen: 'start', score: 0, level: 1, highScore: lastState.highScore } });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
}());
