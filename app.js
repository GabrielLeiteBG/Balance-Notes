(function () {
  'use strict';

  var STORAGE_KEY = 'balanceNotesState';

  var state = loadState();
  var editing = null; // { dayId, entryId } when editing an existing entry
  var currentType = 'in';
  var viewedDayId = null; // set on init, in-memory only (always reopens on today)

  // ---------- State ----------

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.days)) {
          if (typeof parsed.initialBalance !== 'number') parsed.initialBalance = 0;
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Falha ao carregar dados salvos, iniciando vazio.', e);
    }
    return { initialBalance: 0, days: [] };
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  }

  function formatDayId(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function todayId() {
    return formatDayId(new Date());
  }

  function shiftDayId(id, delta) {
    var parts = id.split('-').map(Number);
    var d = new Date(parts[0], parts[1] - 1, parts[2]);
    d.setDate(d.getDate() + delta);
    return formatDayId(d);
  }

  function getEarliestDayId() {
    if (!state.days.length) return todayId();
    return state.days.reduce(function (min, d) { return d.id < min ? d.id : min; }, state.days[0].id);
  }

  function ensureDay(id) {
    var day = state.days.find(function (d) { return d.id === id; });
    if (!day) {
      day = { id: id, entries: [] };
      state.days.push(day);
      state.days.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
      saveState();
    }
    return day;
  }

  // ---------- Formatting ----------

  function formatCurrency(v) {
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function formatSigned(v) {
    var sign = v > 0 ? '+ ' : v < 0 ? '- ' : '';
    return sign + formatCurrency(Math.abs(v));
  }

  function signClass(v) {
    return v > 0 ? 'is-positive' : v < 0 ? 'is-negative' : 'is-zero';
  }

  function parseValue(str) {
    if (!str) return NaN;
    var s = String(str).trim().replace(/[R$\s]/g, '');
    if (s.includes(',') && s.includes('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (s.includes(',')) {
      s = s.replace(',', '.');
    }
    return parseFloat(s);
  }

  function dateLabel(id) {
    var parts = id.split('-').map(Number);
    var date = new Date(parts[0], parts[1] - 1, parts[2]);
    var label = date.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  // ---------- Calculations ----------

  function dayTotal(day) {
    return day.entries.reduce(function (sum, e) {
      return sum + (e.type === 'in' ? e.value : -e.value);
    }, 0);
  }

  function totalBalance() {
    return state.days.reduce(function (sum, d) { return sum + dayTotal(d); }, state.initialBalance);
  }

  function getDayView(id) {
    // computes { day, startBalance, endBalance } for any calendar day id,
    // even one with no stored entries yet (gap days carry the balance forward)
    var start = state.initialBalance;
    var day = null;
    state.days.forEach(function (d) {
      if (d.id < id) start += dayTotal(d);
      else if (d.id === id) day = d;
    });
    var actualDay = day || { id: id, entries: [] };
    return { day: actualDay, startBalance: start, endBalance: start + dayTotal(actualDay) };
  }

  // ---------- Rendering ----------

  var notebookEl = document.getElementById('notebook');
  var totalBalanceEl = document.getElementById('totalBalance');
  var todayBalanceEl = document.getElementById('todayBalance');
  var prevDayBtn = document.getElementById('prevDayBtn');
  var nextDayBtn = document.getElementById('nextDayBtn');

  function render() {
    var total = totalBalance();
    var tId = todayId();
    var todayDay = state.days.find(function (d) { return d.id === tId; });
    var todayBal = todayDay ? dayTotal(todayDay) : 0;

    totalBalanceEl.textContent = formatCurrency(total);
    totalBalanceEl.className = 'summary-value nums ' + signClass(total);

    todayBalanceEl.textContent = formatSigned(todayBal);
    todayBalanceEl.className = 'summary-value nums ' + signClass(todayBal);

    var view = getDayView(viewedDayId);
    notebookEl.innerHTML = '';
    notebookEl.appendChild(buildPage(view));

    var earliestId = getEarliestDayId();
    prevDayBtn.disabled = viewedDayId <= earliestId;
    nextDayBtn.disabled = viewedDayId >= tId;
  }

  function buildPage(c) {
    var day = c.day;
    var isToday = day.id === todayId();
    var total = dayTotal(day);

    var page = document.createElement('article');
    page.className = 'page';

    var header = document.createElement('div');
    header.className = 'page-header';
    header.innerHTML =
      '<div class="page-date">' + dateLabel(day.id) +
      (isToday ? '<span class="today-tag">HOJE</span>' : '') +
      '</div>' +
      '<div class="page-start nums">Início: ' + formatCurrency(c.startBalance) + '</div>';
    page.appendChild(header);

    var entriesEl = document.createElement('div');
    entriesEl.className = 'entries';

    if (!day.entries.length) {
      var none = document.createElement('div');
      none.className = 'no-entries';
      none.textContent = 'Nenhum lançamento neste dia.';
      entriesEl.appendChild(none);
    } else {
      day.entries.forEach(function (entry) {
        entriesEl.appendChild(buildEntryRow(day.id, entry));
      });
    }
    page.appendChild(entriesEl);

    var footer = document.createElement('div');
    footer.className = 'page-footer';
    footer.innerHTML =
      '<span class="page-footer-label">Fim do dia</span>' +
      '<span class="page-footer-total nums ' + signClass(total) + '">' + formatSigned(total) + '</span>' +
      '<span class="page-end-balance nums">Saldo acumulado: ' + formatCurrency(c.endBalance) + '</span>';
    page.appendChild(footer);

    return page;
  }

  function buildEntryRow(dayId, entry) {
    var row = document.createElement('div');
    row.className = 'entry-row';
    row.setAttribute('role', 'button');

    var value = document.createElement('span');
    value.className = 'entry-value nums ' + entry.type;
    value.textContent = formatSigned(entry.type === 'in' ? entry.value : -entry.value);

    var desc = document.createElement('span');
    desc.className = 'entry-desc';
    desc.textContent = entry.description;

    row.appendChild(value);
    row.appendChild(desc);

    if (entry.tag) {
      var tag = document.createElement('span');
      tag.className = 'entry-tag';
      tag.textContent = entry.tag;
      row.appendChild(tag);
    }

    row.addEventListener('click', function () {
      openEntrySheet({ dayId: dayId, entryId: entry.id });
    });

    return row;
  }

  // ---------- Entry sheet ----------

  var overlay = document.getElementById('overlay');
  var entrySheet = document.getElementById('entrySheet');
  var settingsSheet = document.getElementById('settingsSheet');
  var entryForm = document.getElementById('entryForm');
  var entrySheetTitle = document.getElementById('entrySheetTitle');
  var entryValueInput = document.getElementById('entryValue');
  var entryDescriptionInput = document.getElementById('entryDescription');
  var entryTagInput = document.getElementById('entryTag');
  var entryDeleteBtn = document.getElementById('entryDeleteBtn');
  var typeButtons = document.querySelectorAll('.type-btn');

  function setType(type) {
    currentType = type;
    typeButtons.forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.type === type);
    });
  }

  typeButtons.forEach(function (btn) {
    btn.addEventListener('click', function () { setType(btn.dataset.type); });
  });

  function openEntrySheet(editContext) {
    editing = editContext || null;

    if (editing) {
      var day = state.days.find(function (d) { return d.id === editing.dayId; });
      var entry = day && day.entries.find(function (e) { return e.id === editing.entryId; });
      if (!entry) { editing = null; return; }
      entrySheetTitle.textContent = 'Editar lançamento';
      setType(entry.type);
      entryValueInput.value = entry.value.toFixed(2).replace('.', ',');
      entryDescriptionInput.value = entry.description;
      entryTagInput.value = entry.tag || '';
      entryDeleteBtn.classList.remove('hidden');
    } else {
      entrySheetTitle.textContent = viewedDayId === todayId()
        ? 'Novo lançamento'
        : 'Novo lançamento — ' + dateLabel(viewedDayId);
      setType('in');
      entryForm.reset();
      entryDeleteBtn.classList.add('hidden');
    }

    showSheet(entrySheet);
    setTimeout(function () { entryValueInput.focus(); }, 50);
  }

  function closeEntrySheet() {
    hideSheet(entrySheet);
    editing = null;
    entryForm.reset();
  }

  document.getElementById('entryCancelBtn').addEventListener('click', closeEntrySheet);

  entryForm.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var value = parseValue(entryValueInput.value);
    if (!isFinite(value) || value <= 0) {
      entryValueInput.focus();
      return;
    }
    var description = entryDescriptionInput.value.trim() || 'Sem descrição';
    var tag = entryTagInput.value.trim();

    if (editing) {
      var day = state.days.find(function (d) { return d.id === editing.dayId; });
      var entry = day && day.entries.find(function (e) { return e.id === editing.entryId; });
      if (entry) {
        entry.value = value;
        entry.type = currentType;
        entry.description = description;
        entry.tag = tag;
      }
    } else {
      var targetDay = ensureDay(viewedDayId);
      targetDay.entries.push({ id: uid(), value: value, type: currentType, description: description, tag: tag });
    }

    saveState();
    closeEntrySheet();
    render();
  });

  entryDeleteBtn.addEventListener('click', function () {
    if (!editing) return;
    if (!confirm('Excluir este lançamento?')) return;
    var day = state.days.find(function (d) { return d.id === editing.dayId; });
    if (day) {
      day.entries = day.entries.filter(function (e) { return e.id !== editing.entryId; });
    }
    saveState();
    closeEntrySheet();
    render();
  });

  // ---------- Settings sheet ----------

  var initialBalanceInput = document.getElementById('initialBalanceInput');

  function openSettingsSheet() {
    initialBalanceInput.value = state.initialBalance.toFixed(2).replace('.', ',');
    showSheet(settingsSheet);
  }

  document.getElementById('menuBtn').addEventListener('click', openSettingsSheet);
  document.getElementById('settingsCloseBtn').addEventListener('click', function () { hideSheet(settingsSheet); });

  document.getElementById('saveInitialBalanceBtn').addEventListener('click', function () {
    var value = parseValue(initialBalanceInput.value);
    if (!isFinite(value)) value = 0;
    state.initialBalance = value;
    saveState();
    hideSheet(settingsSheet);
    render();
  });

  document.getElementById('clearAllBtn').addEventListener('click', function () {
    if (!confirm('Isso vai apagar TODOS os lançamentos salvos neste dispositivo. Deseja continuar?')) return;
    state = { initialBalance: 0, days: [] };
    saveState();
    viewedDayId = todayId();
    hideSheet(settingsSheet);
    render();
  });

  document.getElementById('exportBtn').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var stamp = todayId();
    a.href = url;
    a.download = 'caderno-financeiro-' + stamp + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  var importFile = document.getElementById('importFile');
  document.getElementById('importBtn').addEventListener('click', function () { importFile.click(); });

  importFile.addEventListener('change', function () {
    var file = importFile.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        if (!parsed || !Array.isArray(parsed.days)) throw new Error('Formato inválido');
        if (!confirm('Importar este arquivo vai substituir os dados atuais. Continuar?')) return;
        state = { initialBalance: typeof parsed.initialBalance === 'number' ? parsed.initialBalance : 0, days: parsed.days };
        saveState();
        viewedDayId = todayId();
        hideSheet(settingsSheet);
        render();
      } catch (e) {
        alert('Não foi possível importar este arquivo. Verifique se é um backup válido.');
      }
    };
    reader.readAsText(file);
    importFile.value = '';
  });

  // ---------- Sheet plumbing ----------

  function showSheet(sheet) {
    overlay.classList.remove('hidden');
    sheet.classList.remove('hidden');
    sheet.setAttribute('aria-hidden', 'false');
  }

  function hideSheet(sheet) {
    sheet.classList.add('hidden');
    sheet.setAttribute('aria-hidden', 'true');
    if (entrySheet.classList.contains('hidden') && settingsSheet.classList.contains('hidden')) {
      overlay.classList.add('hidden');
    }
  }

  overlay.addEventListener('click', function () {
    closeEntrySheet();
    hideSheet(settingsSheet);
  });

  // ---------- FAB ----------

  document.getElementById('fabAdd').addEventListener('click', function () { openEntrySheet(null); });

  // ---------- Day navigation ----------

  prevDayBtn.addEventListener('click', function () {
    var candidate = shiftDayId(viewedDayId, -1);
    if (candidate < getEarliestDayId()) return;
    viewedDayId = candidate;
    render();
  });

  nextDayBtn.addEventListener('click', function () {
    var candidate = shiftDayId(viewedDayId, 1);
    if (candidate > todayId()) return;
    viewedDayId = candidate;
    render();
  });

  // ---------- Init ----------

  viewedDayId = todayId();
  ensureDay(viewedDayId);
  render();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }
})();
