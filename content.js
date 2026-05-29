(function () {
  'use strict';

  // ==========================================
  // CONFIGURAÇÕES GERAIS DO SCRIPT
  // ==========================================
  const CONFIG = {
    MAX_HIST: 30,
    SAVE_DELAY: 900,
    DEFAULT_COLOR: '#e74c3c',
    DEFAULT_WIDTH: 4,
    CORES: [
      { hex: '#e74c3c', nome: 'Vermelho' },
      { hex: '#27ae60', nome: 'Verde'    },
      { hex: '#2980b9', nome: 'Azul'     },
    ],
    ANCORA_SELECTORS: ['.questao-enunciado', '.questao-corpo', '.questao', 'main', 'body']
  };

  // ==========================================
  // ESTADO DA APLICAÇÃO (Single Source of Truth)
  // ==========================================
  const STATE = {
    tracos: [],
    tracoAtual: null,
    historico: [],
    isDrawing: false,
    isEnabled: false,
    isBorracha: false,
    color: CONFIG.DEFAULT_COLOR,
    lineWidth: CONFIG.DEFAULT_WIDTH,
    ancora: null,
    ancoraTopo: 0,
    saveTimer: null,
    ajusteTimer: null,
    questaoIdAtual: null,
    questaoPollingTimer: null
  };

  // ==========================================
  // MÓDULO DE PERSISTÊNCIA E HISTÓRICO
  // ==========================================
  const StorageManager = {
    getStorageKey: () => 'rabisco_v7_' + location.pathname.replace(/\//g, '_'),

 salvarSnapshot() {
   if (STATE.historico.length >= CONFIG.MAX_HIST) STATE.historico.shift();
   STATE.historico.push(JSON.stringify(STATE.tracos));
 },

 desfazer() {
   if (!STATE.historico.length) return;
   STATE.tracos = JSON.parse(STATE.historico.pop());
   CanvasManager.redesenharTudo();
   this.agendarSalvamento();
 },

 agendarSalvamento() {
   clearTimeout(STATE.saveTimer);
   STATE.saveTimer = setTimeout(() => {
     try {
       localStorage.setItem(this.getStorageKey(), JSON.stringify(STATE.tracos));
     } catch (e) {}
   }, CONFIG.SAVE_DELAY);
 },

 carregarTracos() {
   try {
     const dados = localStorage.getItem(this.getStorageKey());
     STATE.tracos = dados ? JSON.parse(dados) : [];
     LayoutManager.atualizarReferenciaAncora();
     CanvasManager.redesenharTudo();
   } catch (e) {
     STATE.tracos = [];
   }
 }
  };

  // ==========================================
  // MÓDULO DO ELEMENTO CANVAS (RENDERIZAÇÃO)
  // ==========================================
  const CanvasManager = {
    canvas: null,
    ctx: null,

    init() {
      if (document.getElementById('rabisco-canvas')) return;
      this.canvas = document.createElement('canvas');
      this.canvas.id = 'rabisco-canvas';
      this.redimensionar();
      document.body.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');
    },

    redimensionar() {
      if (!this.canvas) return;
      this.canvas.width = Math.max(document.body.scrollWidth, window.innerWidth);
      this.canvas.height = Math.max(document.body.scrollHeight, window.innerHeight);
    },

    redesenharTudo() {
      if (!this.ctx) return;
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

      STATE.tracos.forEach(t => this.desenharTracoCompleto(t));
    },

    desenharTracoCompleto(traco) {
      if (traco.points.length < 2) return;

      this.ctx.save();
      this.configurarEstiloContexto(traco);
      this.ctx.beginPath();
      this.ctx.moveTo(traco.points[0].x, traco.points[0].y);

      for (let i = 1; i < traco.points.length; i++) {
        this.ctx.lineTo(traco.points[i].x, traco.points[i].y);
      }

      this.ctx.stroke();
      this.ctx.restore();
    },

    tracarSegmentoAtual() {
      if (!STATE.tracoAtual || STATE.tracoAtual.points.length < 2) return;
      const pts = STATE.tracoAtual.points;
      const prev = pts[pts.length - 2];
      const curr = pts[pts.length - 1];

      this.ctx.save();
      this.configurarEstiloContexto(STATE.tracoAtual);

      this.ctx.beginPath();
      this.ctx.moveTo(prev.x, prev.y);
      this.ctx.lineTo(curr.x, curr.y);
      this.ctx.stroke();

      this.ctx.restore();
    },

    configurarEstiloContexto(traco) {
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';

      if (traco.eraser) {
        this.ctx.globalCompositeOperation = 'destination-out';
        this.ctx.strokeStyle = 'rgba(0,0,0,1)';
        this.ctx.lineWidth = traco.width * 5;
      } else {
        this.ctx.globalCompositeOperation = 'source-over';
        this.ctx.strokeStyle = traco.color;
        this.ctx.lineWidth = traco.width;
      }
    }
  };

  // ==========================================
  // MÓDULO DE GESTÃO DE LAYOUT E MUDANÇA DE TELA
  // ==========================================
  const LayoutManager = {
    encontrarAncora() {
      for (const sel of CONFIG.ANCORA_SELECTORS) {
        const el = document.querySelector(sel);
        if (el) return el;
      }
      return document.body;
    },

    getAncoraTop() {
      let el = STATE.ancora || this.encontrarAncora();
      let top = 0;
      while (el) { top += el.offsetTop || 0; el = el.offsetParent; }
      return top;
    },

    atualizarReferenciaAncora() {
      STATE.ancora = this.encontrarAncora();
      STATE.ancoraTopo = this.getAncoraTop();
    },

    ajustarERedesenhar() {
      if (!CanvasManager.canvas) return;

      const novoTop = this.getAncoraTop();
      const delta = novoTop - STATE.ancoraTopo;

      if (Math.abs(delta) > 1) {
        STATE.tracos.forEach(t => t.points.forEach(p => p.y += delta));
        STATE.ancoraTopo = novoTop;
      }

      CanvasManager.redimensionar();
      CanvasManager.redesenharTudo();
    },

    verificarDeslocamento() {
      if (STATE.isDrawing) return;
      if (Math.abs(LayoutManager.getAncoraTop() - STATE.ancoraTopo) > 30) {
        LayoutManager.ajustarERedesenhar();
      }
    },

    getQuestaoId() {
      const seletores = ['.questao-rg-area-titulo', '.questao-cabecalho', '.questao-titulo', 'main'];
      for (const sel of seletores) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const m = el.textContent.match(/#(\d{5,})/);
        if (m) return m[1];
      }
      return null;
    },

    observarMudancaQuestao() {
      const novoId = this.getQuestaoId();
      if (!novoId) return;
      if (STATE.questaoIdAtual === null) {
        STATE.questaoIdAtual = novoId;
        return;
      }
      if (novoId !== STATE.questaoIdAtual) {
        STATE.questaoIdAtual = novoId;
        STATE.tracos = [];
        STATE.historico = [];
        CanvasManager.redesenharTudo();
      }
    }
  };

  // ==========================================
  // MÓDULO INTERFACE GRÁFICA (UI)
  // ==========================================
  const UIManager = {
    SVGS: {
      toggle: `<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z'/></svg>`,
      borracha: `<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M20 20H7L3 16l11-11 7 7-1.5 1.5'/><path d='M6.5 17.5 16 8'/></svg>`,
      desfazer: `<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M3 7v6h6'/><path d='M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13'/></svg>`,
      limpar: `<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='3 6 5 6 21 6'/><path d='M19 6l-1 14H6L5 6'/><path d='M10 11v6'/><path d='M14 11v6'/><path d='M9 6V4h6v2'/></svg>`
    },

    setAtivo(on) {
      STATE.isEnabled = on;
      document.querySelectorAll('#rab-toggle').forEach(btn => btn.classList.toggle('rab-on', on));
      if (!on) {
        this.setBorracha(false);
        document.body.classList.remove('rab-modo-desenho', 'rab-modo-borracha');
      } else {
        document.body.classList.toggle('rab-modo-desenho', !STATE.isBorracha);
      }
    },

    setBorracha(on) {
      STATE.isBorracha = on;
      document.querySelectorAll('#rab-borracha').forEach(btn => btn.classList.toggle('rab-on', on));
      document.body.classList.toggle('rab-modo-borracha', on);
      if (STATE.isEnabled) {
        document.body.classList.toggle('rab-modo-desenho', !on);
      }
    },

    criarBotao(id, title, svgContent, onClick, onContextMenu = null) {
      const btn = document.createElement('button');
      btn.className = 'questao-navegacao-botao rab-btn';
      btn.id = id;
      btn.title = title;
      btn.innerHTML = svgContent;
      btn.addEventListener('click', onClick);
      if (onContextMenu) btn.addEventListener('contextmenu', onContextMenu);
      return btn;
    },

    criarPopup(miniDot) {
      const popup = document.createElement('div');
      popup.id = 'rab-popup';

      const rowCores = document.createElement('div');
      rowCores.className = 'rab-pop-row';

      CONFIG.CORES.forEach(({ hex, nome }) => {
        const dot = document.createElement('div');
        dot.className = 'rab-dot' + (hex === STATE.color ? ' rab-sel' : '');
        dot.style.background = hex;
        dot.title = nome;
        dot.addEventListener('click', (e) => {
          e.stopPropagation();
          STATE.color = hex;
          miniDot.style.background = hex;
          popup.querySelectorAll('.rab-dot').forEach(d => d.classList.remove('rab-sel'));
          dot.classList.add('rab-sel');
          this.setAtivo(true);
          this.setBorracha(false);
          popup.classList.remove('rab-open');
        });
        rowCores.appendChild(dot);
      });

      const rowEsp = document.createElement('div');
      rowEsp.className = 'rab-pop-row';
      rowEsp.innerHTML = '<span>Esp:</span>';

      const slider = document.createElement('input');
      slider.type = 'range'; slider.className = 'rab-slider';
      slider.min = 1; slider.max = 26; slider.value = STATE.lineWidth;
      slider.addEventListener('click', e => e.stopPropagation());
      slider.addEventListener('input', () => { STATE.lineWidth = parseInt(slider.value); });

      rowEsp.appendChild(slider);
      popup.appendChild(rowCores);
      popup.appendChild(rowEsp);
      return popup;
    },

    construirPainelControles() {
      const wrap = document.createElement('span');
      wrap.id = 'rab-wrapper';

      const miniDot = document.createElement('span');
      miniDot.id = 'rab-mini-dot';
      miniDot.style.background = STATE.color;

      const popup = this.criarPopup(miniDot);

      const btnToggle = this.criarBotao('rab-toggle', 'Ativar Rabisco (Alt+R)', this.SVGS.toggle, (e) => {
        e.stopPropagation();
        if (popup.classList.contains('rab-open')) { popup.classList.remove('rab-open'); return; }
        this.setAtivo(!STATE.isEnabled);
      }, (e) => {
        e.preventDefault(); e.stopPropagation();
        popup.classList.toggle('rab-open');
      });
      btnToggle.appendChild(miniDot);
      btnToggle.appendChild(popup);

      const btnBorracha = this.criarBotao('rab-borracha', 'Borracha', this.SVGS.borracha, (e) => {
        e.stopPropagation();
        const novoEst = !STATE.isBorracha;
        this.setBorracha(novoEst);
        if (novoEst && !STATE.isEnabled) this.setAtivo(true);
      });

        const btnUndo = this.criarBotao('rab-desfazer', 'Desfazer (Alt+Z)', this.SVGS.desfazer, (e) => {
          e.stopPropagation(); StorageManager.desfazer();
        });

        const btnClear = this.criarBotao('rab-limpar', 'Apagar tudo', this.SVGS.limpar, (e) => {
          e.stopPropagation();
          if (!confirm('Apagar todos os rabiscos desta página?')) return;
          StorageManager.salvarSnapshot();
          STATE.tracos = [];
          CanvasManager.redesenharTudo();
          StorageManager.agendarSalvamento();
        });

        wrap.appendChild(btnToggle);
        wrap.appendChild(btnBorracha);
        wrap.appendChild(btnUndo);
        wrap.appendChild(btnClear);

        document.addEventListener('click', () => popup.classList.remove('rab-open'));
        return wrap;
    },

    injetarNasBarras() {
      if (document.getElementById('rab-wrapper')) return;

      const barraNavegacao = document.querySelector('.questao-navegacao');
      const barraCabecalho = document.querySelector('.questao-cabecalho');

      // Aplica alinhamento flex e injeta os botões na barra inferior
      if (barraNavegacao) {
        barraNavegacao.style.alignItems = 'center';
        barraNavegacao.style.display = barraNavegacao.style.display || 'flex';
        barraNavegacao.appendChild(this.construirPainelControles());
      }

      // Injeta também na barra superior (se houver layout ativo nela)
      if (barraCabecalho) {
        barraCabecalho.style.alignItems = 'center';
        barraCabecalho.appendChild(this.construirPainelControles());
      }

      LayoutManager.atualizarReferenciaAncora();
    }
  };

  // ==========================================
  // ESCUTADORES DE EVENTOS DO NAVEGADOR
  // ==========================================
  const EventHandlers = {
    isUIElement: (e) => e.target.closest('#rab-wrapper,#rab-popup,button,a,input,select,textarea,[role="button"]') !== null,

 handleStart(x, y, isUI) {
   if (!STATE.isEnabled || isUI) return;
   StorageManager.salvarSnapshot();
   STATE.isDrawing = true;
   STATE.tracoAtual = { color: STATE.color, width: STATE.lineWidth, eraser: STATE.isBorracha, points: [{ x, y }] };
 },

 handleMove(x, y) {
   if (!STATE.isDrawing || !STATE.isEnabled || !STATE.tracoAtual) return;
   STATE.tracoAtual.points.push({ x, y });
   CanvasManager.tracarSegmentoAtual();
 },

 handleEnd() {
   if (!STATE.isDrawing || !STATE.tracoAtual) return;
   STATE.isDrawing = false;
   if (STATE.tracoAtual.points.length > 1) STATE.tracos.push(STATE.tracoAtual);
   STATE.tracoAtual = null;
   StorageManager.agendarSalvamento();
 },

 init() {
   // Eventos do Mouse
   document.addEventListener('mousedown', (e) => {
     if (STATE.isEnabled && !this.isUIElement(e)) e.preventDefault();
     this.handleStart(e.pageX, e.pageY, this.isUIElement(e));
   });
   document.addEventListener('mousemove', (e) => this.handleMove(e.pageX, e.pageY));
   document.addEventListener('mouseup', () => this.handleEnd());

   // Eventos Touch (Mobile)
   document.addEventListener('touchstart', (e) => {
     if (STATE.isEnabled && !this.isUIElement(e)) e.preventDefault();
     const t = e.touches[0];
     this.handleStart(t.pageX, t.pageY, this.isUIElement(e));
   }, { passive: false });
   document.addEventListener('touchmove', (e) => {
     if (STATE.isEnabled) e.preventDefault();
     const t = e.touches[0];
     this.handleMove(t.pageX, t.pageY);
   }, { passive: false });
   document.addEventListener('touchend', () => this.handleEnd());

   // Atalhos e Outros
   document.addEventListener('selectstart', (e) => { if (STATE.isEnabled) e.preventDefault(); });
   document.addEventListener('keydown', (e) => {
     if (e.altKey && e.key.toLowerCase() === 'r') UIManager.setAtivo(!STATE.isEnabled);
     if (e.altKey && e.key.toLowerCase() === 'z') StorageManager.desfazer();
   });

     // Redimensionamento e Mutações de layout
     window.addEventListener('resize', () => {
       clearTimeout(STATE.ajusteTimer);
       STATE.ajusteTimer = setTimeout(() => { if (!STATE.isDrawing) LayoutManager.ajustarERedesenhar(); }, 300);
     });

     document.addEventListener('click', (e) => {
       if (e.target.closest('button, a')) {
         clearTimeout(STATE.ajusteTimer);
         STATE.ajusteTimer = setTimeout(LayoutManager.verificarDeslocamento, 300);
       }
     });
 }
  };

  // ==========================================
  // INICIALIZAÇÃO E MONITORIZAÇÃO DO SISTEMA
  // ==========================================
  function bootstrap() {
    CanvasManager.init();
    UIManager.injetarNasBarras();
    StorageManager.carregarTracos();

    // Polling para detecção de mudança de questão por AJAX
    STATE.questaoIdAtual = LayoutManager.getQuestaoId();
    clearInterval(STATE.questaoPollingTimer);
    STATE.questaoPollingTimer = setInterval(() => LayoutManager.observarMudancaQuestao(), 500);

    // Observador para reinjetar a barra caso o DOM seja limpo/reconstruído
    const domObs = new MutationObserver(() => {
      if (!document.getElementById('rab-wrapper') && document.querySelector('.questao-navegacao')) {
        UIManager.injetarNasBarras();
      }
      clearTimeout(STATE.ajusteTimer);
      STATE.ajusteTimer = setTimeout(LayoutManager.verificarDeslocamento, 200);
    });
    domObs.observe(document.body, { childList: true, subtree: true });

    // Tratamento de transições de histórico SPA (Single Page Application)
    const interceptarMudancaUrl = () => {
      document.getElementById('rab-wrapper')?.remove();
      setTimeout(() => {
        UIManager.injetarNasBarras();
        StorageManager.carregarTracos();
        STATE.questaoIdAtual = LayoutManager.getQuestaoId();
      }, 1000);
    };

    const origPush = history.pushState.bind(history);
    history.pushState = function (...args) { origPush(...args); interceptarMudancaUrl(); };
    window.addEventListener('popstate', interceptarMudancaUrl);
  }

  // Executa a aplicação
  bootstrap();
  EventHandlers.init();

})();
