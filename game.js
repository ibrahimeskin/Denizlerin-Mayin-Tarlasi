/* ============================================================
   DENIZLERIN MAYIN TARLASI — GAME LOGIC
   ============================================================ */

// ── Difficulty presets ─────────────────────────────────────
const DIFFICULTIES = {
  easy: { rows: 9, cols: 9, mines: 10 },
  medium: { rows: 16, cols: 16, mines: 40 },
  hard: { rows: 16, cols: 30, mines: 99 },
  custom: { rows: 12, cols: 12, mines: 20 },  // default, overridden by panel
};

// ── State ──────────────────────────────────────────────────
let state = {
  diff: 'easy',
  rows: 0,
  cols: 0,
  mines: 0,
  board: [],     // { mine, adjacent, revealed, flagged }
  gameOver: false,
  won: false,
  started: false,
  flagsPlaced: 0,
  timer: 0,
  timerID: null,
  activePower: null,  // 'sonar' | 'diver' | 'torpedo' | null
  powers: { sonar: 0, diver: 0, torpedo: 0 },
};

// Power uses per difficulty
const POWER_USES = {
  easy:   { sonar: 2, diver: 1, torpedo: 1 },
  medium: { sonar: 3, diver: 2, torpedo: 1 },
  hard:   { sonar: 4, diver: 3, torpedo: 2 },
  custom: { sonar: 3, diver: 2, torpedo: 1 },  // default, overridden by panel
};

const POWER_HINTS = {
  sonar:  '🔊 Sonar aktif — Taranacak noktaya tıkla (5×5 alan)',
  diver:  '🤿 Dalgıç aktif — Güvenle açılacak hücreye tıkla',
  torpedo:'🚀 Torpido aktif — Bir hücreye tıkla (satır + sütun açılır)',
};

// ── DOM refs ───────────────────────────────────────────────
const boardEl = document.getElementById('board');
const mineCountEl = document.getElementById('mine-count');
const flagCountEl = document.getElementById('flag-count');
const timerEl = document.getElementById('timer');
const modal = document.getElementById('modal');
const modalIcon = document.getElementById('modal-icon');
const modalTitle = document.getElementById('modal-title');
const modalDesc = document.getElementById('modal-desc');
const modalStats = document.getElementById('modal-stats');
const modalAgain = document.getElementById('modal-play-again');
const bubblesEl = document.getElementById('bubbles');

// ── Mine image helper ─────────────────────────────────────
function mineImg() {
  return '<img src="mine.png" class="mine-img" alt="mayın" draggable="false">';
}

// ── Explosion effect ───────────────────────────────────
const SPARK_COLORS = ['#ffcc00', '#ff8800', '#ff4400', '#ffffff', '#ffee44'];

function triggerExplosion(cellEl, delay = 0) {
  setTimeout(() => {
    // Hide the mine image during the blast
    const img = cellEl.querySelector('.mine-img');
    if (img) img.style.opacity = '0';

    // Explosion container
    const exp = document.createElement('div');
    exp.className = 'explosion';

    // Sparks
    const SPARK_COUNT = 10;
    for (let i = 0; i < SPARK_COUNT; i++) {
      const angle = (i / SPARK_COUNT) * 360;
      const dist = 28 + Math.random() * 28; // px
      const rad = angle * Math.PI / 180;
      const tx = Math.round(Math.cos(rad) * dist);
      const ty = Math.round(Math.sin(rad) * dist);
      const dur = (0.35 + Math.random() * 0.25).toFixed(2);
      const d = (Math.random() * 0.08).toFixed(2);
      const color = SPARK_COLORS[i % SPARK_COLORS.length];
      const spark = document.createElement('div');
      spark.className = 'spark';
      spark.style.cssText = `--tx:${tx}px;--ty:${ty}px;--dur:${dur}s;--delay:${d}s;background:${color};`;
      exp.appendChild(spark);
    }

    // Smoke puff
    const smoke = document.createElement('div');
    smoke.className = 'smoke';
    exp.appendChild(smoke);

    cellEl.appendChild(exp);

    // Clean up after animation finishes
    setTimeout(() => {
      exp.remove();
      if (img) img.style.opacity = '1';
    }, 900);
  }, delay);
}

// ── Bubble generator ───────────────────────────────────────
function spawnBubbles(diff) {
  bubblesEl.innerHTML = '';
  // Fewer bubbles on hard to reduce GPU load
  const count = diff === 'hard' ? 8 : diff === 'medium' ? 12 : 18;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const b = document.createElement('div');
    b.className = 'bubble';
    const size = Math.random() * 18 + 6;
    const left = Math.random() * 100;
    const dur = Math.random() * 12 + 8;
    const delay = Math.random() * 10;
    b.style.cssText = `width:${size}px;height:${size}px;left:${left}%;animation-duration:${dur}s;animation-delay:-${delay}s;`;
    frag.appendChild(b);
  }
  bubblesEl.appendChild(frag);
}

// ── Init game ──────────────────────────────────────────────
function initGame(diff, customCfg) {
  diff = diff || state.diff;
  const cfg = customCfg || DIFFICULTIES[diff];
  const pwr = customCfg ? { sonar: customCfg.sonar || 0, diver: customCfg.diver || 0, torpedo: customCfg.torpedo || 0 } : { ...POWER_USES[diff] };

  clearInterval(state.timerID);

  // Cancel any pending reveal batches
  if (state.revealRAF) cancelAnimationFrame(state.revealRAF);

  state = {
    diff,
    rows: cfg.rows,
    cols: cfg.cols,
    mines: cfg.mines,
    board: [],
    cells: [],   // flat cache: cells[r * cols + c] = { el, inner }
    gameOver: false,
    won: false,
    started: false,
    flagsPlaced: 0,
    timer: 0,
    timerID: null,
    revealRAF: null,
    activePower: null,
    powers: pwr,
  };

  deactivatePower();
  updatePowerUI();

  // Build empty board
  for (let r = 0; r < cfg.rows; r++) {
    state.board.push([]);
    for (let c = 0; c < cfg.cols; c++) {
      state.board[r].push({ mine: false, adjacent: 0, revealed: false, flagged: false });
    }
  }

  spawnBubbles(diff);
  updateStats();
  applyCellSize(cfg.rows, cfg.cols);
  renderBoard();
}

// ── Dynamic cell sizing ───────────────────────────────────
function applyCellSize(rows, cols) {
  const vw = window.innerWidth;
  const maxWidth = Math.min(vw - 80, 1240);
  const gap = 3;
  const padding = 40; // board-frame padding
  const availW = maxWidth - padding;
  const availH = window.innerHeight * 0.6;
  let size = Math.floor((availW - (cols - 1) * gap) / cols);
  size = Math.min(size, Math.floor((availH - (rows - 1) * gap) / rows));
  size = Math.max(size, 20);
  size = Math.min(size, 42);
  const fontSize = size <= 26 ? '0.65rem' : size <= 32 ? '0.8rem' : '1rem';
  document.documentElement.style.setProperty('--cell-size', size + 'px');
  document.documentElement.style.setProperty('--cell-font', fontSize);
}

// ── Place mines (after first click) ───────────────────────
function placeMines(safeRow, safeCol) {
  const { rows, cols, mines, board } = state;
  let placed = 0;

  // Safe zone: 3×3 around first click
  const safeSet = new Set();
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const r2 = safeRow + dr, c2 = safeCol + dc;
      if (r2 >= 0 && r2 < rows && c2 >= 0 && c2 < cols) {
        safeSet.add(r2 * cols + c2);
      }
    }
  }

  while (placed < mines) {
    const r = Math.floor(Math.random() * rows);
    const c = Math.floor(Math.random() * cols);
    const key = r * cols + c;
    if (!board[r][c].mine && !safeSet.has(key)) {
      board[r][c].mine = true;
      placed++;
    }
  }

  // Calculate adjacency counts
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!board[r][c].mine) {
        board[r][c].adjacent = countAdjMines(r, c);
      }
    }
  }
}

function countAdjMines(r, c) {
  let count = 0;
  forEachNeighbor(r, c, (nr, nc) => { if (state.board[nr][nc].mine) count++; });
  return count;
}

function forEachNeighbor(r, c, fn) {
  const { rows, cols } = state;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) fn(nr, nc);
    }
  }
}

// ── Render ─────────────────────────────────────────────────
function renderBoard() {
  const { rows, cols, board } = state;

  boardEl.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  boardEl.innerHTML = '';

  // Remove old delegated listeners before re-attaching
  boardEl.removeEventListener('click', onBoardClick);
  boardEl.removeEventListener('contextmenu', onBoardRightClick);

  const frag = document.createDocumentFragment();
  state.cells = new Array(rows * cols);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = document.createElement('div');
      const inner = document.createElement('span');
      inner.className = 'cell-inner';
      cell.className = 'cell hidden';
      // Encode position in a single data attribute for fast parsing
      cell.dataset.idx = r * cols + c;
      cell.appendChild(inner);
      state.cells[r * cols + c] = { el: cell, inner };
      frag.appendChild(cell);
    }
  }

  boardEl.appendChild(frag);

  // Single delegated listener for the whole board
  boardEl.addEventListener('click', onBoardClick);
  boardEl.addEventListener('contextmenu', onBoardRightClick);
}

// ── Fast cell DOM update ───────────────────────────────────
// Only sets what changed; never calls querySelector
function setCellRevealed(idx, data) {
  const { el, inner } = state.cells[idx];
  el.className = 'cell revealed';
  inner.className = 'cell-inner';
  if (data.mine) {
    el.classList.add('mine-revealed');
    inner.innerHTML = mineImg();
  } else if (data.adjacent > 0) {
    inner.textContent = data.adjacent;
    inner.classList.add(`n${data.adjacent}`);
  } else {
    inner.textContent = '';
  }
}

function setCellFlagged(idx, flagged) {
  const { el, inner } = state.cells[idx];
  if (flagged) {
    el.className = 'cell flagged';
    inner.textContent = '⚓';
  } else {
    el.className = 'cell hidden';
    inner.textContent = '';
  }
}

// ── Delegated Click Handlers ───────────────────────────────
function onBoardClick(e) {
  if (state.gameOver) return;
  const target = e.target.closest('[data-idx]');
  if (!target) return;

  const idx = +target.dataset.idx;
  const cols = state.cols;
  const r = Math.floor(idx / cols);
  const c = idx % cols;
  const data = state.board[r][c];

  // ── Power intercept ──
  if (state.activePower) {
    if (data.revealed) return;
    // Ensure board is started before using powers
    if (!state.started) {
      state.started = true;
      placeMines(r, c);
      startTimer();
    }
    executePower(state.activePower, r, c);
    return;
  }

  if (data.revealed || data.flagged) return;

  if (!state.started) {
    state.started = true;
    placeMines(r, c);
    startTimer();
  }

  revealCell(r, c, true);
  checkWin();
}

function onBoardRightClick(e) {
  e.preventDefault();
  if (state.gameOver) return;
  const target = e.target.closest('[data-idx]');
  if (!target) return;

  const idx = +target.dataset.idx;
  const cols = state.cols;
  const r = Math.floor(idx / cols);
  const c = idx % cols;
  const data = state.board[r][c];

  if (data.revealed) return;

  data.flagged = !data.flagged;
  state.flagsPlaced += data.flagged ? 1 : -1;
  setCellFlagged(idx, data.flagged);
  updateStats();
}

// ── Reveal logic ───────────────────────────────────────────
// animate=true only for the single user-clicked cell
function revealCell(r, c, animate) {
  const { rows, cols, board, cells } = state;
  const startData = board[r][c];
  if (startData.revealed || startData.flagged) return;

  // Hit a mine — handle immediately
  startData.revealed = true;
  const startIdx = r * cols + c;
  setCellRevealed(startIdx, startData);

  if (startData.mine) {
    revealAllMines(r, c);
    endGame(false);
    return;
  }

  // Optional pop animation only for the clicked cell
  if (animate) {
    const { el } = cells[startIdx];
    el.classList.add('reveal-anim');
    el.addEventListener('animationend', () => el.classList.remove('reveal-anim'), { once: true });
  }

  if (startData.adjacent !== 0) return; // numbered cell, no flood-fill needed

  // ── Iterative BFS flood-fill (no setTimeout, no recursion) ────
  const queue = [r * cols + c];
  const visited = new Uint8Array(rows * cols); // fast bitset
  visited[r * cols + c] = 1;

  // Process in chunks via rAF to keep the page responsive
  function processChunk() {
    const CHUNK = 120; // cells per frame
    let processed = 0;
    while (queue.length > 0 && processed < CHUNK) {
      const idx = queue.shift();
      const cr = Math.floor(idx / cols);
      const cc = idx % cols;

      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = cr + dr, nc = cc + dc;
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          const nidx = nr * cols + nc;
          if (visited[nidx]) continue;
          const ndata = board[nr][nc];
          if (ndata.revealed || ndata.flagged) continue;

          visited[nidx] = 1;
          ndata.revealed = true;
          setCellRevealed(nidx, ndata);
          processed++;

          if (ndata.adjacent === 0) queue.push(nidx);
        }
      }
    }

    if (queue.length > 0) {
      state.revealRAF = requestAnimationFrame(processChunk);
    } else {
      state.revealRAF = null;
      checkWin();
    }
  }

  state.revealRAF = requestAnimationFrame(processChunk);
  return; // checkWin called inside processChunk when done
}

function revealAllMines(hitR, hitC) {
  const { rows, cols, board, cells } = state;
  const hitIdx = hitR * cols + hitC;

  // Show the hit mine, then explode
  const hitCell = cells[hitIdx];
  hitCell.el.className = 'cell mine-hit';
  hitCell.inner.innerHTML = mineImg();
  triggerExplosion(hitCell.el, 80);   // slight delay so user sees the mine first

  // Reveal remaining mines in batches via rAF for smooth animation
  const mineList = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (board[r][c].mine && !board[r][c].flagged && !(r === hitR && c === hitC)) {
        mineList.push(r * cols + c);
      }
    }
  }

  let mi = 0;
  const BATCH = 8; // mines revealed per frame
  function revealBatch() {
    const end = Math.min(mi + BATCH, mineList.length);
    for (; mi < end; mi++) {
      const idx = mineList[mi];
      board[Math.floor(idx / cols)][idx % cols].revealed = true;
      const { el, inner } = cells[idx];
      el.className = 'cell mine-revealed';
      inner.innerHTML = mineImg();
      // Staggered small explosions for each revealed mine
      triggerExplosion(el, 80 + mi * 35);
    }
    if (mi < mineList.length) requestAnimationFrame(revealBatch);
  }
  requestAnimationFrame(revealBatch);
}

// ── Win / Loss ─────────────────────────────────────────────
function checkWin() {
  if (state.gameOver) return;
  const { rows, cols, mines, board } = state;
  let unrevealed = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!board[r][c].revealed) unrevealed++;
    }
  }
  if (unrevealed === mines) {
    endGame(true);
  }
}

function endGame(won) {
  clearInterval(state.timerID);
  state.gameOver = true;
  state.won = won;

  let delay;
  if (won) {
    delay = 700;
  } else {
    // Son mayının patlama başlangıcı: 80 + (mines-1)*35 ms
    // Patlama animasyonu ~950 ms sürer
    // Üstüne 700 ms dramatik bekleme
    const lastExplosionStart = 80 + (state.mines - 1) * 35;
    delay = lastExplosionStart + 950 + 700;
  }

  setTimeout(() => showModal(won), delay);
}

function showModal(won) {
  const elapsed = state.timer;
  const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
  const secs = (elapsed % 60).toString().padStart(2, '0');

  if (won) {
    modalIcon.textContent = '⚓';
  } else {
    modalIcon.textContent = '';
    modalIcon.innerHTML = `<img src="mine.png" class="modal-mine-img" alt="mayın">`;
  }
  modalTitle.textContent = won ? 'Güvenli Geçiş!' : 'Patlama!';
  modalDesc.textContent = won
    ? 'Tüm mayınları atlattın, kaptan! Okyanus senindir.'
    : 'Bir mayına çarptın! Denizler tehlikelidir...';

  modalStats.innerHTML = `
    ⏱️ Süre: <strong>${mins}:${secs}</strong><br>
    <img src="mine.png" style="width:16px;height:16px;vertical-align:middle"> Mayın: <strong>${state.mines}</strong><br>
    ⚓ Çıpa: <strong>${state.flagsPlaced}</strong>
  `;

  modal.style.display = 'flex';
}

// ── Timer ──────────────────────────────────────────────────
function startTimer() {
  state.timer = 0;
  state.timerID = setInterval(() => {
    state.timer++;
    timerEl.textContent = state.timer.toString().padStart(3, '0');
    if (state.timer >= 999) clearInterval(state.timerID);
  }, 1000);
}

// ── Stats ──────────────────────────────────────────────────
function updateStats() {
  mineCountEl.textContent = state.mines - state.flagsPlaced;
  flagCountEl.textContent = state.flagsPlaced;
  timerEl.textContent = state.timer.toString().padStart(3, '0');
}

// ══════════════════════════════════════════════════════════════
//  POWER SYSTEM
// ══════════════════════════════════════════════════════════════

const powerHint     = document.getElementById('power-hint');
const powerHintText = document.getElementById('power-hint-text');
const powerCancel   = document.getElementById('power-cancel');

// ── Activate / Deactivate ──
function activatePower(name) {
  if (state.gameOver) return;
  if (state.powers[name] <= 0) return;

  // Toggle off if same
  if (state.activePower === name) { deactivatePower(); return; }

  state.activePower = name;

  // UI
  document.querySelectorAll('.power-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`[data-power="${name}"]`).classList.add('active');
  powerHintText.textContent = POWER_HINTS[name];
  powerHint.style.display = 'flex';

  // Board cursor class
  boardEl.className = boardEl.className.replace(/power-\w+-active/g, '');
  boardEl.classList.add(`power-${name}-active`);
}

function deactivatePower() {
  state.activePower = null;
  document.querySelectorAll('.power-btn').forEach(b => b.classList.remove('active'));
  powerHint.style.display = 'none';
  boardEl.className = boardEl.className.replace(/power-\w+-active/g, '').trim();
}

function updatePowerUI() {
  ['sonar', 'diver', 'torpedo'].forEach(name => {
    const btn  = document.querySelector(`[data-power="${name}"]`);
    const uses = document.getElementById(`pw-${name}-uses`);
    uses.textContent = state.powers[name];
    btn.disabled = state.powers[name] <= 0;
  });
}

function usePower(name) {
  state.powers[name]--;
  updatePowerUI();
  deactivatePower();
}

// ── Execute power on cell ──
function executePower(name, r, c) {
  switch (name) {
    case 'sonar':  execSonar(r, c);  break;
    case 'diver':  execDiver(r, c);  break;
    case 'torpedo': execTorpedo(r, c); break;
  }
}

// ── 🔊 SONAR ─────────────────────────────────────────────────
// Scans a 5×5 area around (r, c). Highlights mines for 3 seconds.
function execSonar(centerR, centerC) {
  const { rows, cols, board, cells } = state;
  usePower('sonar');

  const SCAN_RADIUS = 2; // 5×5 = ±2
  const scannedCells = [];
  const mineCells    = [];

  for (let dr = -SCAN_RADIUS; dr <= SCAN_RADIUS; dr++) {
    for (let dc = -SCAN_RADIUS; dc <= SCAN_RADIUS; dc++) {
      const nr = centerR + dr, nc = centerC + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const idx  = nr * cols + nc;
      const data = board[nr][nc];
      const { el } = cells[idx];

      if (data.revealed) continue;

      if (data.mine) {
        el.classList.add('sonar-mine-found');
        mineCells.push(el);
      } else {
        el.classList.add('sonar-scanned');
      }
      scannedCells.push(el);
    }
  }

  // Sonar ring visual
  const boardFrame = boardEl.parentElement;
  const centerCell = cells[centerR * cols + centerC].el;
  const rect = centerCell.getBoundingClientRect();
  const frameRect = boardFrame.getBoundingClientRect();
  const ring = document.createElement('div');
  ring.className = 'sonar-ring';
  const ringSize = (SCAN_RADIUS * 2 + 1) * 42; // approx
  ring.style.cssText = `
    width: ${ringSize}px; height: ${ringSize}px;
    top: ${rect.top - frameRect.top + rect.height / 2}px;
    left: ${rect.left - frameRect.left + rect.width / 2}px;
  `;
  boardFrame.style.position = 'relative';
  boardFrame.appendChild(ring);
  setTimeout(() => ring.remove(), 850);

  // Remove highlights after 3 seconds
  setTimeout(() => {
    scannedCells.forEach(el => {
      el.classList.remove('sonar-scanned', 'sonar-mine-found');
    });
  }, 3000);
}

// ── 🤿 DIVER ─────────────────────────────────────────────────
// Safely reveals one cell. If mine → auto-flags, no explosion.
function execDiver(r, c) {
  const { cols, board, cells } = state;
  const data = board[r][c];
  if (data.revealed) return;
  usePower('diver');

  const idx = r * cols + c;
  const { el } = cells[idx];
  el.classList.add('diver-safe');

  if (data.mine) {
    // Auto-flag instead of dying
    if (!data.flagged) {
      data.flagged = true;
      state.flagsPlaced++;
      setCellFlagged(idx, true);
      updateStats();
    }
  } else {
    // Safely reveal
    revealCell(r, c, true);
    checkWin();
  }

  setTimeout(() => el.classList.remove('diver-safe'), 700);
}

// ── 🚀 TORPEDO ───────────────────────────────────────────────
// Reveals entire row + column. Mines get auto-flagged.
function execTorpedo(r, c) {
  const { rows, cols, board, cells } = state;
  usePower('torpedo');

  const targets = new Set();

  // Entire row
  for (let cc = 0; cc < cols; cc++) targets.add(r * cols + cc);
  // Entire column
  for (let rr = 0; rr < rows; rr++) targets.add(rr * cols + c);

  // Highlight briefly
  targets.forEach(idx => {
    const { el } = cells[idx];
    el.classList.add('torpedo-target');
  });

  // Reveal after a short delay for visual feedback
  setTimeout(() => {
    targets.forEach(idx => {
      const tr = Math.floor(idx / cols);
      const tc = idx % cols;
      const data = board[tr][tc];
      const { el } = cells[idx];

      el.classList.remove('torpedo-target');

      if (data.revealed) return;

      if (data.mine) {
        if (!data.flagged) {
          data.flagged = true;
          state.flagsPlaced++;
          setCellFlagged(idx, true);
        }
      } else {
        data.revealed = true;
        setCellRevealed(idx, data);
        // Flood-fill if empty
        if (data.adjacent === 0) {
          floodFillSync(tr, tc);
        }
      }
    });

    updateStats();
    checkWin();
  }, 250);
}

// Synchronous flood-fill for torpedo (no rAF needed, small scope)
function floodFillSync(startR, startC) {
  const { rows, cols, board, cells } = state;
  const queue = [startR * cols + startC];
  const visited = new Set();
  visited.add(startR * cols + startC);

  while (queue.length > 0) {
    const idx = queue.shift();
    const cr = Math.floor(idx / cols);
    const cc = idx % cols;

    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = cr + dr, nc = cc + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        const nidx = nr * cols + nc;
        if (visited.has(nidx)) continue;
        const ndata = board[nr][nc];
        if (ndata.revealed || ndata.flagged) continue;

        visited.add(nidx);
        ndata.revealed = true;
        setCellRevealed(nidx, ndata);

        if (ndata.adjacent === 0) queue.push(nidx);
      }
    }
  }
}

// ── Power button event listeners ──
document.querySelectorAll('.power-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const name = btn.dataset.power;
    activatePower(name);
  });
});

powerCancel.addEventListener('click', deactivatePower);

// ══════════════════════════════════════════════════════════════

// ── Difficulty buttons ─────────────────────────────────────
const customPanel = document.getElementById('custom-panel');

document.querySelectorAll('.diff-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const diff = btn.dataset.diff;
    state.diff = diff;

    if (diff === 'custom') {
      customPanel.style.display = 'block';
      return; // Don't start game yet
    }

    customPanel.style.display = 'none';
    modal.style.display = 'none';
    initGame(diff);
  });
});

document.getElementById('btn-new-game').addEventListener('click', () => {
  modal.style.display = 'none';
  if (state.diff === 'custom') {
    startCustomGame();
  } else {
    initGame(state.diff);
  }
});

modalAgain.addEventListener('click', () => {
  modal.style.display = 'none';
  if (state.diff === 'custom') {
    startCustomGame();
  } else {
    initGame(state.diff);
  }
});

// ══════════════════════════════════════════════════════════════
//  CUSTOM MODE PANEL
// ══════════════════════════════════════════════════════════════

const cstRows    = document.getElementById('cst-rows');
const cstCols    = document.getElementById('cst-cols');
const cstMines   = document.getElementById('cst-mines');
const cstSonar   = document.getElementById('cst-sonar');
const cstDiver   = document.getElementById('cst-diver');
const cstTorpedo = document.getElementById('cst-torpedo');
const cstInfo    = document.getElementById('custom-info');

// Sync slider value displays
const sliders = [
  { el: cstRows,    valId: 'cst-rows-val' },
  { el: cstCols,    valId: 'cst-cols-val' },
  { el: cstMines,   valId: 'cst-mines-val' },
  { el: cstSonar,   valId: 'cst-sonar-val' },
  { el: cstDiver,   valId: 'cst-diver-val' },
  { el: cstTorpedo, valId: 'cst-torpedo-val' },
];

sliders.forEach(({ el, valId }) => {
  const valEl = document.getElementById(valId);
  el.addEventListener('input', () => {
    valEl.textContent = el.value;
    updateCustomInfo();
  });
});

function updateCustomInfo() {
  const rows  = +cstRows.value;
  const cols  = +cstCols.value;
  const total = rows * cols;
  let mines   = +cstMines.value;

  // Clamp mines
  const maxMines = total - 9; // must leave safe zone
  if (mines > maxMines) {
    mines = Math.max(1, maxMines);
    cstMines.value = mines;
    document.getElementById('cst-mines-val').textContent = mines;
  }
  cstMines.max = maxMines;

  const pct = ((mines / total) * 100).toFixed(1);
  cstInfo.textContent = `Toplam: ${total} hücre, ${mines} mayın (%${pct})`;
}

function startCustomGame() {
  const cfg = {
    rows:    +cstRows.value,
    cols:    +cstCols.value,
    mines:   +cstMines.value,
    sonar:   +cstSonar.value,
    diver:   +cstDiver.value,
    torpedo: +cstTorpedo.value,
  };

  // Safety clamp
  const maxMines = cfg.rows * cfg.cols - 9;
  cfg.mines = Math.min(cfg.mines, Math.max(1, maxMines));

  customPanel.style.display = 'none';
  modal.style.display = 'none';
  initGame('custom', cfg);
}

document.getElementById('custom-start').addEventListener('click', startCustomGame);

// Init custom info on load
updateCustomInfo();

// ── Boot ──────────────────────────────────────────────────
initGame('easy');
