import { sections, Q_TYPE, SURVEY_META } from './questions.js';

const STORAGE_KEY = 'auri_survey_responses';
const STORAGE_PAGE_KEY = 'auri_survey_page';
const STORAGE_TOKEN_KEY = 'auri_survey_token';
const API_BASE = import.meta.env.VITE_API_BASE || '';

const GATE = {
  LOADING: 'loading',
  REGISTER: 'register',
  DENIED: 'denied',
  RESUBMIT_CHOICE: 'resubmit_choice',
  READ_ONLY: 'read_only',
  OPEN: 'open',
};

const EDIT_MODE = {
  NEW: 'new',
  EDIT: 'edit',
};

export class SurveyEngine {
  constructor(container) {
    this.container = container;
    const urlToken = new URLSearchParams(window.location.search).get('token');
    this.fromUrlToken = Boolean(urlToken);
    this.token = urlToken || localStorage.getItem(STORAGE_TOKEN_KEY) || null;
    this.participant = null;
    this.submitted = false;
    this.submittedAt = null;
    this.updatedAt = null;
    this.editMode = EDIT_MODE.NEW;
    this.gate = this.token ? GATE.LOADING : GATE.REGISTER;
    this.responses = this.loadResponses();
    this.currentPage = 0;
    this.visibleSections = [];
    this.editingParticipant = false;
    this.participantFormError = '';
    this.registerError = '';
    this.registerBusy = false;

    if (this.token) {
      this.verifyToken().then(() => this.render());
    } else {
      this.render();
    }
  }

  async verifyToken() {
    try {
      const res = await fetch(`${API_BASE}/api/survey/${this.token}`);
      if (!res.ok) {
        // 저장해 둔 토큰이 서버에 없으면(초기화 등) 자기등록으로 되돌린다.
        if (!this.fromUrlToken) {
          this.clearIdentity();
          this.gate = GATE.REGISTER;
        } else {
          this.gate = GATE.DENIED;
        }
        return;
      }
      const data = await res.json();
      this.applyParticipant(data);
    } catch {
      this.gate = GATE.DENIED;
    }
  }

  applyParticipant(data) {
    this.participant = data;
    this.token = data.token;
    localStorage.setItem(STORAGE_TOKEN_KEY, data.token);
    this.submittedAt = data.submitted_at || null;
    this.updatedAt = data.updated_at || null;
    if (data.has_responded && data.responses) {
      this.responses = { ...this.responses, ...data.responses };
      this.saveResponses();
      this.submitted = true;
      this.gate = GATE.RESUBMIT_CHOICE;
    } else {
      this.gate = GATE.OPEN;
    }
  }

  clearIdentity() {
    localStorage.removeItem(STORAGE_TOKEN_KEY);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_PAGE_KEY);
    this.token = null;
    this.participant = null;
    this.responses = {};
    this.submitted = false;
    this.submittedAt = null;
    this.updatedAt = null;
    this.editMode = EDIT_MODE.NEW;
    this.currentPage = 0;
  }

  // ── 자기등록 (공개 링크 응답자) ──
  renderRegister() {
    const m = SURVEY_META;
    const errHtml = this.registerError
      ? `<p class="participant-error">${this.escape(this.registerError)}</p>`
      : '';

    this.container.innerHTML = `
      <div class="survey-container">
        <div class="survey-header">
          <div class="institution">${m.institution}</div>
          <h1>${m.title}</h1>
          <div class="subtitle">${m.subtitle}</div>
        </div>

        <div class="intro-card">
          <h2>응답자 정보</h2>
          <p>본 조사는 <strong>「건축물의 복합용도 활성화 지원 특별법」의 위임 세부기준</strong>을 전문가 합의로 확정하기 위한 제1차 조사입니다. 응답 전 아래 정보를 입력해 주십시오.</p>
          <p style="margin-top:10px">입력하신 정보는 <strong>응답 확인·수정 및 2라운드 안내</strong>에만 사용되며, 분석 결과는 통계 처리되어 익명으로만 공표됩니다.</p>
        </div>

        <div class="participant-card editing">
          <div class="participant-card-header">
            <h3>정보 입력</h3>
          </div>
          <div class="participant-form">
            <label>
              <span>이름 <em class="req">*</em></span>
              <input type="text" id="r-name" autocomplete="name" />
            </label>
            <label>
              <span>소속 <em class="req">*</em></span>
              <input type="text" id="r-org" autocomplete="organization" placeholder="예: ○○대학교 건축학과 / ○○건축사사무소" />
            </label>
            <label>
              <span>이메일 <em class="req">*</em></span>
              <input type="email" id="r-email" autocomplete="email" placeholder="name@example.com" />
            </label>
            <label>
              <span>직위·직급</span>
              <input type="text" id="r-position" autocomplete="organization-title" placeholder="선택 입력" />
            </label>
            <label>
              <span>연락처</span>
              <input type="tel" id="r-phone" autocomplete="tel" placeholder="선택 입력 (010-0000-0000)" />
            </label>
          </div>
          ${errHtml}
          <p class="register-hint">
            같은 이메일로 다시 접속하시면 이전 응답을 이어서 <strong>수정</strong>하실 수 있습니다.
          </p>
          <div class="participant-actions">
            <button class="btn btn-next" id="btn-register">설문 시작하기</button>
          </div>
        </div>

        <div class="intro-card">
          <h2>안내</h2>
          <dl class="intro-meta">
            <dt>소요 시간</dt><dd>${m.duration}</dd>
            <dt>비밀보장</dt><dd>모든 응답은 통계 처리 후 익명 활용</dd>
            <dt>연구책임</dt><dd>${m.researcher} (${m.contact})</dd>
          </dl>
        </div>
      </div>
    `;

    const submit = () => this.submitRegistration();
    this.container.querySelector('#btn-register').addEventListener('click', submit);
    this.container.querySelectorAll('.participant-form input').forEach(el => {
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
      });
    });
    this.container.querySelector('#r-name')?.focus();
  }

  async submitRegistration() {
    if (this.registerBusy) return;

    const val = id => (this.container.querySelector(id)?.value || '').trim();
    const payload = {
      name: val('#r-name'),
      org: val('#r-org'),
      email: val('#r-email'),
      position: val('#r-position'),
      phone: val('#r-phone'),
    };

    if (!payload.name) return this.failRegister('이름을 입력해 주십시오.', '#r-name');
    if (!payload.org) return this.failRegister('소속을 입력해 주십시오.', '#r-org');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
      return this.failRegister('올바른 이메일을 입력해 주십시오.', '#r-email');
    }

    this.registerBusy = true;
    const btn = this.container.querySelector('#btn-register');
    if (btn) { btn.disabled = true; btn.textContent = '확인 중…'; }

    try {
      const res = await fetch(`${API_BASE}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `등록 실패 (${res.status})`);
      }
      const data = await res.json();
      this.registerBusy = false;
      this.registerError = '';
      this.applyParticipant(data);
      this.render();
    } catch (err) {
      this.registerBusy = false;
      if (btn) { btn.disabled = false; btn.textContent = '설문 시작하기'; }
      this.failRegister(err.message || '등록 중 오류가 발생했습니다. 잠시 후 다시 시도해 주십시오.');
    }
  }

  failRegister(msg, focusSel) {
    this.registerError = msg;
    const values = {
      '#r-name': this.container.querySelector('#r-name')?.value || '',
      '#r-org': this.container.querySelector('#r-org')?.value || '',
      '#r-email': this.container.querySelector('#r-email')?.value || '',
      '#r-position': this.container.querySelector('#r-position')?.value || '',
      '#r-phone': this.container.querySelector('#r-phone')?.value || '',
    };
    this.renderRegister();
    for (const [sel, v] of Object.entries(values)) {
      const el = this.container.querySelector(sel);
      if (el) el.value = v;
    }
    this.container.querySelector(focusSel || '#r-name')?.focus();
  }

  // ── Persistence ──
  loadResponses() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  }

  saveResponses() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.responses));
    localStorage.setItem(STORAGE_PAGE_KEY, String(this.currentPage));
  }

  getResponse(id) { return this.responses[id]; }
  setResponse(id, value) {
    this.responses[id] = value;
    this.saveResponses();
  }

  // ── Section Visibility (branching) ──
  updateVisibleSections() {
    this.visibleSections = sections.filter(s => {
      if (!s.showWhen) return true;
      const v = this.responses[s.showWhen.questionId];
      if (v === undefined) return false;
      if (Array.isArray(s.showWhen.values)) return s.showWhen.values.includes(v);
      return v === s.showWhen.value;
    });
  }

  // ── Render Router ──
  render() {
    if (this.gate === GATE.LOADING) {
      this.renderLoading();
      return;
    }
    if (this.gate === GATE.REGISTER) {
      this.renderRegister();
      return;
    }
    if (this.gate === GATE.DENIED) {
      this.renderAccessDenied();
      return;
    }
    if (this.gate === GATE.RESUBMIT_CHOICE) {
      this.renderResubmitChoice();
      return;
    }

    this.updateVisibleSections();
    if (this.currentPage === 0) {
      this.renderIntro();
    } else if (this.currentPage > this.visibleSections.length) {
      this.renderCompletion();
    } else {
      this.renderSection(this.visibleSections[this.currentPage - 1]);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ── Loading ──
  renderLoading() {
    this.container.innerHTML = `
      <div class="survey-container">
        <div class="completion" style="padding:160px 20px">
          <div class="spinner"></div>
          <style>@keyframes spin{to{transform:rotate(360deg)}}.spinner{width:40px;height:40px;border:3px solid #e0e0e0;border-top:3px solid #2c2c2c;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 24px}</style>
          <p style="color:var(--c-text-secondary)">설문 링크를 확인 중입니다…</p>
        </div>
      </div>
    `;
  }

  // ── Access Denied ──
  renderAccessDenied() {
    const m = SURVEY_META;
    this.container.innerHTML = `
      <div class="survey-container">
        <div class="access-denied">
          <div class="access-denied-icon">
            <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.6">
              <circle cx="12" cy="12" r="9"></circle>
              <line x1="5.6" y1="5.6" x2="18.4" y2="18.4"></line>
            </svg>
          </div>
          <h1>링크를 확인할 수 없습니다</h1>
          <p class="access-denied-msg">
            접속하신 링크의 참여자 정보를 찾을 수 없습니다.<br/>
            아래 버튼을 눌러 응답자 정보를 직접 입력하고 참여하실 수 있습니다.
          </p>
          <button class="btn btn-next" id="btn-to-register" style="margin-top:8px">응답자 정보 입력하고 참여하기</button>
          <div class="access-denied-meta">
            <dl>
              <dt>조사기관</dt><dd>${m.institution}</dd>
              <dt>연구책임</dt><dd>${m.researcher}</dd>
              <dt>문의</dt><dd>${m.contact}</dd>
            </dl>
          </div>
        </div>
      </div>
    `;
    this.container.querySelector('#btn-to-register')?.addEventListener('click', () => {
      this.clearIdentity();
      this.fromUrlToken = false;
      this.gate = GATE.REGISTER;
      this.render();
    });
  }

  // ── Resubmit Choice (이미 제출한 토큰 재접근) ──
  renderResubmitChoice() {
    const p = this.participant || {};
    const submittedStr = this.submittedAt ? this.formatDateTime(this.submittedAt) : '';
    const updatedStr = this.updatedAt ? this.formatDateTime(this.updatedAt) : '';

    this.container.innerHTML = `
      <div class="survey-container">
        <div class="resubmit-choice">
          <div class="resubmit-badge">제출 완료</div>
          <h1>이미 응답을 제출하셨습니다</h1>
          <div class="resubmit-meta">
            <dl>
              <dt>응답자</dt><dd>${this.escape(p.name || '-')}${p.org ? ` · ${this.escape(p.org)}` : ''}</dd>
              <dt>최초 제출</dt><dd>${submittedStr || '-'}</dd>
              ${updatedStr ? `<dt>최근 수정</dt><dd>${updatedStr}</dd>` : ''}
            </dl>
          </div>
          <p class="resubmit-msg">
            응답 내용을 <strong>수정</strong>하시거나, 제출한 응답을 <strong>확인</strong>만 하실 수 있습니다.
          </p>
          <div class="resubmit-actions">
            <button class="btn btn-next" id="btn-edit-mode">응답 수정하기</button>
            <button class="btn btn-prev" id="btn-view-mode">내 응답 확인 (읽기전용)</button>
          </div>
        </div>
      </div>
    `;
    this.container.querySelector('#btn-edit-mode').addEventListener('click', () => {
      this.editMode = EDIT_MODE.EDIT;
      this.gate = GATE.OPEN;
      this.currentPage = 0;
      this.render();
    });
    this.container.querySelector('#btn-view-mode').addEventListener('click', () => {
      this.gate = GATE.READ_ONLY;
      this.render();
    });
  }

  // ── Status Bar (공통 상단) ──
  renderStatusBar() {
    let status, statusClass;
    if (this.submitted && this.editMode === EDIT_MODE.EDIT) {
      status = '수정 중';
      statusClass = 'status-editing';
    } else if (this.submitted) {
      status = '제출 완료';
      statusClass = 'status-done';
    } else {
      status = '미제출';
      statusClass = 'status-pending';
    }

    const submittedInfo = this.submittedAt
      ? `<span class="status-time">제출: ${this.formatDateTime(this.submittedAt)}</span>`
      : '';
    const updatedInfo = this.updatedAt
      ? `<span class="status-time">수정: ${this.formatDateTime(this.updatedAt)}</span>`
      : '';

    return `
      <div class="status-info-bar">
        <div class="status-info-inner">
          <span class="status-badge ${statusClass}">${status}</span>
          <div class="status-times">
            ${submittedInfo}
            ${updatedInfo}
          </div>
        </div>
      </div>
    `;
  }

  // ── Participant Info Card ──
  renderParticipantCard() {
    const p = this.participant;
    if (!p) return '';

    const isSelf = p.source === 'self';

    if (this.editingParticipant) {
      const errHtml = this.participantFormError
        ? `<p class="participant-error">${this.escape(this.participantFormError)}</p>`
        : '';
      const emailField = isSelf
        ? `<label>
              <span>이메일</span>
              <input type="email" id="p-email" value="${this.escape(p.email || '')}" readonly />
              <small class="field-hint">응답 식별자로 사용되어 변경할 수 없습니다.</small>
            </label>`
        : `<label>
              <span>이메일</span>
              <input type="email" id="p-email" value="${this.escape(p.email || '')}" />
            </label>`;
      return `
        <div class="participant-card editing">
          <div class="participant-card-header">
            <h3>내 정보 수정</h3>
          </div>
          <div class="participant-form">
            <label>
              <span>이름</span>
              <input type="text" id="p-name" value="${this.escape(p.name || '')}" />
            </label>
            ${emailField}
            <label>
              <span>소속</span>
              <input type="text" id="p-org" value="${this.escape(p.org || '')}" />
            </label>
            <label>
              <span>직위·직급</span>
              <input type="text" id="p-position" value="${this.escape(p.position || '')}" />
            </label>
            <label>
              <span>연락처</span>
              <input type="tel" id="p-phone" value="${this.escape(p.phone || '')}" placeholder="010-0000-0000" />
            </label>
          </div>
          ${errHtml}
          <div class="participant-actions">
            <button class="btn btn-prev" id="btn-p-cancel">취소</button>
            <button class="btn btn-next" id="btn-p-save">저장</button>
          </div>
        </div>
      `;
    }

    const categoryRow = p.category
      ? `<dt>직군</dt><dd class="readonly">${this.escape(p.category)} <span class="hint">(사전 분류)</span></dd>`
      : '';
    const switchBtn = isSelf
      ? `<button class="btn-link btn-link-quiet" id="btn-p-switch">다른 응답자로 시작</button>`
      : '';

    return `
      <div class="participant-card">
        <div class="participant-card-header">
          <h3>내 정보</h3>
          <div class="participant-card-tools">
            ${switchBtn}
            <button class="btn-link" id="btn-p-edit">수정</button>
          </div>
        </div>
        <dl class="participant-info">
          <dt>이름</dt><dd>${this.escape(p.name || '-')}</dd>
          <dt>이메일</dt><dd>${this.escape(p.email || '-')}</dd>
          <dt>소속</dt><dd>${this.escape(p.org || '-')}</dd>
          <dt>직위</dt><dd>${this.escape(p.position || '-')}</dd>
          <dt>연락처</dt><dd>${this.escape(p.phone || '-')}</dd>
          ${categoryRow}
        </dl>
      </div>
    `;
  }

  bindParticipantEvents() {
    this.container.querySelector('#btn-p-edit')?.addEventListener('click', () => {
      this.editingParticipant = true;
      this.participantFormError = '';
      this.render();
    });
    this.container.querySelector('#btn-p-cancel')?.addEventListener('click', () => {
      this.editingParticipant = false;
      this.participantFormError = '';
      this.render();
    });
    this.container.querySelector('#btn-p-save')?.addEventListener('click', () => {
      this.saveParticipant();
    });
    this.container.querySelector('#btn-p-switch')?.addEventListener('click', () => {
      if (!confirm('다른 응답자로 새로 시작하시겠습니까?\n\n현재 브라우저에 저장된 응답 내용이 지워집니다. 이미 제출하신 응답은 서버에 그대로 보관되며, 같은 이메일로 다시 접속하면 이어서 수정하실 수 있습니다.')) return;
      this.clearIdentity();
      this.fromUrlToken = false;
      this.registerError = '';
      this.gate = GATE.REGISTER;
      this.render();
    });
  }

  async saveParticipant() {
    const nameEl = this.container.querySelector('#p-name');
    const emailEl = this.container.querySelector('#p-email');
    const orgEl = this.container.querySelector('#p-org');
    const positionEl = this.container.querySelector('#p-position');
    const phoneEl = this.container.querySelector('#p-phone');

    const payload = {
      name: nameEl.value.trim(),
      org: orgEl.value.trim(),
      position: positionEl ? positionEl.value.trim() : '',
      phone: phoneEl.value.trim(),
    };
    // 자기등록 응답자의 이메일은 토큰 파생 키이므로 변경 대상에서 제외한다.
    if (this.participant?.source !== 'self') {
      payload.email = emailEl.value.trim();
    }

    if (!payload.name) {
      this.participantFormError = '이름을 입력해 주십시오.';
      this.render();
      return;
    }
    if (!payload.org) {
      this.participantFormError = '소속을 입력해 주십시오.';
      this.render();
      return;
    }
    if ('email' in payload && (!payload.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email))) {
      this.participantFormError = '올바른 이메일을 입력해 주십시오.';
      this.render();
      return;
    }

    const saveBtn = this.container.querySelector('#btn-p-save');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '저장 중…'; }

    try {
      const res = await fetch(`${API_BASE}/api/survey/${this.token}/participant`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `저장 실패 (${res.status})`);
      }
      const data = await res.json();
      this.participant = { ...this.participant, ...data.participant };
      this.editingParticipant = false;
      this.participantFormError = '';
      this.render();
    } catch (err) {
      this.participantFormError = err.message || '저장 중 오류가 발생했습니다.';
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '저장'; }
      this.render();
    }
  }

  // ── Intro ──
  renderIntro() {
    const m = SURVEY_META;
    const statusBar = this.renderStatusBar();
    const participantCard = this.renderParticipantCard();
    const startLabel = this.submitted && this.editMode === EDIT_MODE.EDIT
      ? '응답 수정 시작하기'
      : '설문 시작하기';

    this.container.innerHTML = `
      ${statusBar}
      <div class="progress-bar-wrap"><div class="progress-bar-inner">
        <div class="progress-track"><div class="progress-fill" style="width:0%"></div></div>
        <span class="progress-label">0%</span>
      </div></div>
      <div class="survey-container with-status-bar">
        <div class="survey-header">
          <div class="institution">${m.institution}</div>
          <h1>${m.title}</h1>
          <div class="subtitle">${m.subtitle}</div>
        </div>

        ${participantCard}

        <div class="intro-card">
          <h2>연구 소개</h2>
          <p>건축공간연구원(AURI)은 「건축물의 복합용도 활성화 지원 특별법」의 위임 세부기준을 마련하고 있습니다. 본 조사는 <strong>용도전환 설계기준</strong>(비주거→주거 전환의 14개 분야)과 <strong>적응형 설계기준</strong>(가변성·전환성·확장성 3대 영역·등급)의 항목·경계값·가중치를 전문가 합의로 확정하기 위한 제1차 조사입니다.</p>
        </div>

        <div class="intro-card">
          <h2>설문 구성</h2>
          <ul style="margin-top:4px">
            <li>PART 0 (공통): 응답자 정보 및 <strong>조사 분과 선택</strong></li>
            <li>PART A: 용도전환 설계기준 (선택 시)</li>
            <li>PART B: 적응형 설계기준 — AHP 가중치·경계값 (선택 시)</li>
            <li>PART C (공통): 종합 의견</li>
          </ul>
          <dl class="intro-meta">
            <dt>소요 시간</dt><dd>${m.duration}</dd>
            <dt>비밀보장</dt><dd>모든 응답은 통계 처리 후 익명 활용</dd>
            <dt>연구책임</dt><dd>${m.researcher} (${m.contact})</dd>
          </dl>
        </div>

        <button class="btn-start" id="btn-start">${startLabel}</button>
      </div>
    `;
    this.bindParticipantEvents();
    this.container.querySelector('#btn-start')?.addEventListener('click', () => {
      this.currentPage = 1;
      this.render();
    });
  }

  // ── Section ──
  renderSection(section) {
    const pct = Math.round((this.currentPage / (this.visibleSections.length + 1)) * 100);
    const isLast = this.currentPage === this.visibleSections.length;
    const statusBar = this.renderStatusBar();
    const submitLabel = this.submitted && this.editMode === EDIT_MODE.EDIT ? '수정 내용 제출' : '제출하기';

    let html = `
      ${statusBar}
      <div class="progress-bar-wrap"><div class="progress-bar-inner">
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
        <span class="progress-label">${pct}%</span>
      </div></div>
      <div class="survey-container with-status-bar">
        <div class="section">
          <div class="section-header">
            <span class="section-tag">${section.tag}</span>
            <h2>${section.title}</h2>
            <p class="section-subtitle">${section.subtitle}</p>
          </div>
    `;

    for (const q of section.questions) {
      html += this.renderQuestion(q);
    }

    html += `</div></div>`;
    html += `
      <div class="nav-bar"><div class="nav-inner">
        <button class="btn btn-prev" id="btn-prev">&larr; 이전</button>
        ${isLast
          ? `<button class="btn btn-submit" id="btn-next">${submitLabel}</button>`
          : '<button class="btn btn-next" id="btn-next">다음 &rarr;</button>'
        }
      </div></div>
    `;

    this.container.innerHTML = html;
    this.bindEvents(section);
    this.restoreValues(section);
  }

  renderQuestion(q) {
    if (q.type === Q_TYPE.SUB_QUESTIONS) {
      return this.renderSubQuestions(q);
    }

    let inner = '';
    const noteHtml = q.note ? `<p class="question-note">${q.note}</p>` : '';

    switch (q.type) {
      case Q_TYPE.SINGLE:
      case Q_TYPE.SINGLE_WITH_OTHER:
        inner = this.renderOptions(q, 'radio', q.type === Q_TYPE.SINGLE_WITH_OTHER);
        break;
      case Q_TYPE.MULTI:
      case Q_TYPE.MULTI_LIMIT:
        inner = this.renderOptions(q, 'checkbox');
        break;
      case Q_TYPE.MULTI_WITH_OTHER:
      case Q_TYPE.MULTI_LIMIT_OTHER:
        inner = this.renderOptions(q, 'checkbox', true);
        break;
      case Q_TYPE.LIKERT_TABLE:
        inner = this.renderLikertTable(q);
        break;
      case Q_TYPE.TEXT:
        inner = this.renderTextInput(q);
        break;
      case Q_TYPE.AHP_PAIRWISE:
        inner = this.renderAhpPairwise(q);
        break;
    }

    return `
      <div class="question-block" data-qid="${q.id}">
        <div class="question-label">
          <span class="question-id">${q.id.replace(/([A-Z]+)(\d)/, '$1-$2')}</span>
          <span class="question-text">${q.text}</span>
        </div>
        ${noteHtml}
        ${inner}
        <p class="question-error" data-error="${q.id}"></p>
      </div>
    `;
  }

  renderOptions(q, inputType, hasOther = false) {
    let html = `<div class="option-list" data-qid="${q.id}" data-type="${inputType}">`;
    const name = q.id;
    q.options.forEach((opt, i) => {
      html += `
        <label class="option-item" data-index="${i}">
          <input type="${inputType}" name="${name}" value="${i}" />
          <span class="option-text">${opt}</span>
        </label>
      `;
    });
    if (hasOther) {
      html += `
        <label class="option-item other-row" data-index="other">
          <input type="${inputType}" name="${name}" value="other" />
          <span class="option-text">${q.otherLabel || '기타'}:</span>
          <input type="text" class="other-text" data-qid="${q.id}_other" placeholder="직접 입력" />
        </label>
      `;
    }
    html += '</div>';
    return html;
  }

  renderLikertTable(q) {
    let html = '<div class="likert-table-wrap"><table class="likert-table" data-qid="' + q.id + '">';
    html += '<thead><tr><th></th>';
    q.scaleLabels.forEach((l, i) => { html += `<th>${i + 1}<br><span style="font-weight:400">${l}</span></th>`; });
    html += '</tr></thead><tbody>';
    q.items.forEach((item, idx) => {
      html += `<tr data-row="${idx}">`;
      html += `<td><span class="item-number">(${idx + 1})</span>${item}</td>`;
      for (let v = 1; v <= q.scaleLabels.length; v++) {
        html += `<td><input type="radio" class="likert-radio" name="${q.id}_${idx}" value="${v}" /></td>`;
      }
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    return html;
  }

  renderTextInput(q) {
    const isIdCode = q.id === 'ID_CODE';
    const cls = isIdCode ? 'text-input id-code-input' : 'text-input';
    if (isIdCode) {
      return `<input type="text" class="${cls}" data-qid="${q.id}" placeholder="${q.placeholder || ''}" maxlength="10" />`;
    }
    return `<textarea class="${cls}" data-qid="${q.id}" placeholder="${q.placeholder || ''}" rows="4"></textarea>`;
  }

  // ── AHP Pairwise ──
  ahpPairs(n) {
    const pairs = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push([i, j]);
    return pairs;
  }

  renderAhpPairwise(q) {
    const scale = q.scaleLabels || { 1: '동등', 3: '약간 중요', 5: '중요', 7: '매우 중요', 9: '절대적으로 중요' };
    let html = `<div class="ahp-block" data-qid="${q.id}">`;
    html += `<p class="ahp-goal">기준: <strong>${this.escape(q.goal || '')}</strong></p>`;
    this.ahpPairs(q.elements.length).forEach(([i, j]) => {
      html += `
        <div class="ahp-pair" data-pair="${i}_${j}">
          <div class="ahp-pair-head">
            <span class="ahp-el">${this.escape(q.elements[i])}</span>
            <span class="ahp-vs">vs</span>
            <span class="ahp-el">${this.escape(q.elements[j])}</span>
          </div>
          <div class="ahp-winner" data-role="winner">
            <label class="ahp-opt"><input type="radio" name="${q.id}_w_${i}_${j}" value="${i}" /> <span>${this.escape(q.elements[i])}</span></label>
            <label class="ahp-opt"><input type="radio" name="${q.id}_w_${i}_${j}" value="eq" /> <span>동등</span></label>
            <label class="ahp-opt"><input type="radio" name="${q.id}_w_${i}_${j}" value="${j}" /> <span>${this.escape(q.elements[j])}</span></label>
          </div>
          <div class="ahp-intensity" data-role="intensity">
            <span class="ahp-int-label">중요도</span>
            ${[1, 3, 5, 7, 9].map(v => `<label class="ahp-opt ahp-int"><input type="radio" name="${q.id}_s_${i}_${j}" value="${v}" /> <span>${v}<br><em>${scale[v]}</em></span></label>`).join('')}
          </div>
        </div>`;
    });
    html += `<div class="ahp-cr" data-cr="${q.id}"><span class="ahp-cr-hint">모든 쌍을 비교하면 일관성비율(CR)이 표시됩니다.</span></div>`;
    html += `</div>`;
    return html;
  }

  // reciprocal matrix → priority vector(geometric mean) + CR
  computeAhp(elements, pairs) {
    const n = elements.length;
    const M = Array.from({ length: n }, () => Array(n).fill(1));
    let complete = true;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const p = pairs[`${i}_${j}`];
        if (!p || (p.winner !== 'eq' && !p.intensity)) { complete = false; continue; }
        let a;
        if (p.winner === 'eq') a = 1;
        else if (p.winner === i) a = p.intensity;
        else a = 1 / p.intensity;
        M[i][j] = a; M[j][i] = 1 / a;
      }
    }
    const gm = M.map(row => Math.pow(row.reduce((x, y) => x * y, 1), 1 / n));
    const sum = gm.reduce((a, b) => a + b, 0);
    const weights = gm.map(x => x / sum);
    let cr = 0;
    if (n > 2 && complete) {
      let lambda = 0;
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let j = 0; j < n; j++) s += M[i][j] * weights[j];
        lambda += s / weights[i];
      }
      lambda /= n;
      const RI = { 1: 0, 2: 0, 3: 0.58, 4: 0.9, 5: 1.12, 6: 1.24, 7: 1.32, 8: 1.41, 9: 1.45, 10: 1.49 };
      const ci = (lambda - n) / (n - 1);
      cr = RI[n] ? ci / RI[n] : 0;
    }
    return { weights, cr, complete };
  }

  collectAhp(qid) {
    const block = this.container.querySelector(`.ahp-block[data-qid="${qid}"]`);
    if (!block) return;
    const q = this.findQuestion(qid);
    const pairs = {};
    block.querySelectorAll('.ahp-pair').forEach(pr => {
      const key = pr.dataset.pair;
      const [i, j] = key.split('_').map(Number);
      const w = pr.querySelector(`input[name="${qid}_w_${i}_${j}"]:checked`);
      const s = pr.querySelector(`input[name="${qid}_s_${i}_${j}"]:checked`);
      const isEq = w && w.value === 'eq';
      // 동등 선택 시 중요도 비활성화
      pr.querySelectorAll('.ahp-intensity input').forEach(inp => { inp.disabled = !!isEq; });
      pr.querySelector('.ahp-intensity')?.classList.toggle('disabled', !!isEq);
      if (w) {
        pairs[key] = {
          winner: isEq ? 'eq' : parseInt(w.value),
          intensity: isEq ? 1 : (s ? parseInt(s.value) : null),
        };
      }
    });
    const { weights, cr, complete } = this.computeAhp(q.elements, pairs);
    this.setResponse(qid, { pairs, weights, cr });
    this.renderCr(qid, cr, complete, q);
  }

  renderCr(qid, cr, complete, q) {
    const el = this.container.querySelector(`.ahp-cr[data-cr="${qid}"]`);
    if (!el) return;
    if (!complete) {
      el.className = 'ahp-cr';
      el.innerHTML = '<span class="ahp-cr-hint">모든 쌍을 비교하면 일관성비율(CR)이 표시됩니다.</span>';
      return;
    }
    const n = q.elements.length;
    const val = this.getResponse(qid) || {};
    const weightStr = (val.weights || []).map((w, i) => `${this.escape(q.elements[i])} ${(w * 100).toFixed(1)}%`).join(' · ');
    if (n <= 2) {
      el.className = 'ahp-cr ok';
      el.innerHTML = `<div class="ahp-weights">${weightStr}</div>`;
      return;
    }
    const ok = cr < 0.1;
    el.className = `ahp-cr ${ok ? 'ok' : 'bad'}`;
    el.innerHTML = `
      <div class="ahp-cr-row"><strong>CR = ${cr.toFixed(3)}</strong> ${ok ? '<span class="ahp-badge ok">일관성 양호</span>' : '<span class="ahp-badge bad">일관성 부족 (재검토)</span>'}</div>
      <div class="ahp-weights">가중치: ${weightStr}</div>
      ${ok ? '' : '<div class="ahp-cr-help">CR &lt; 0.1 이 되도록 모순되는 비교를 조정해 주십시오. (예: A&gt;B, B&gt;C 인데 C&gt;A)</div>'}
    `;
  }

  renderSubQuestions(q) {
    let html = `
      <div class="question-block" data-qid="${q.id}">
        <div class="question-label">
          <span class="question-id">${q.id.replace(/([A-Z]+)(\d)/, '$1-$2')}</span>
          <span class="question-text">${q.text}</span>
        </div>
        <div class="sub-question-group">
    `;
    for (const sq of q.subQuestions) {
      const noteHtml = sq.note ? `<p class="sub-question-note">${sq.note}</p>` : '';
      let inner = '';
      if (sq.type === Q_TYPE.SINGLE) {
        inner = this.renderOptions(sq, 'radio');
      } else if (sq.type === Q_TYPE.MULTI_WITH_OTHER || sq.type === Q_TYPE.MULTI_LIMIT_OTHER) {
        inner = this.renderOptions(sq, 'checkbox', true);
      } else if (sq.type === Q_TYPE.MULTI) {
        inner = this.renderOptions(sq, 'checkbox');
      }
      html += `
        <div class="sub-question" data-qid="${sq.id}">
          <div class="sub-question-label">${sq.label}</div>
          ${noteHtml}
          ${inner}
          <p class="question-error" data-error="${sq.id}"></p>
        </div>
      `;
    }
    html += '</div></div>';
    return html;
  }

  // ── Event Binding ──
  bindEvents(section) {
    this.container.querySelector('#btn-prev')?.addEventListener('click', () => {
      this.currentPage--;
      if (this.currentPage < 0) this.currentPage = 0;
      this.render();
    });

    this.container.querySelector('#btn-next')?.addEventListener('click', () => {
      if (this.validateSection(section)) {
        this.currentPage++;
        this.updateVisibleSections();
        this.render();
      }
    });

    this.container.querySelectorAll('.option-list').forEach(list => {
      const qid = list.dataset.qid;
      const type = list.dataset.type;
      const q = this.findQuestion(qid);

      list.querySelectorAll('.option-item').forEach(item => {
        item.addEventListener('click', (e) => {
          if (e.target.classList.contains('other-text')) return;
          const input = item.querySelector('input[type="radio"], input[type="checkbox"]');
          if (!input || input.disabled) return;
          // 브라우저가 label 클릭으로 input.checked를 이미 토글함 → rAF 후 확정 상태를 읽어 동기화 (수동 토글 금지)
          requestAnimationFrame(() => {
            if (type === 'radio') {
              list.querySelectorAll('.option-item').forEach(oi => oi.classList.remove('selected'));
              item.classList.add('selected');
              const raw = input.value;
              this.setResponse(qid, /^\d+$/.test(raw) ? parseInt(raw) : raw);
            } else {
              item.classList.toggle('selected', input.checked);
              this.collectMultiResponse(qid, list, q);
            }

            if (q && q.exclusive !== undefined && input.checked) {
              const idx = parseInt(item.dataset.index);
              if (idx === q.exclusive) {
                list.querySelectorAll('.option-item').forEach(oi => {
                  if (oi !== item) {
                    const cb = oi.querySelector('input[type="checkbox"]');
                    if (cb) { cb.checked = false; oi.classList.remove('selected'); }
                  }
                });
              } else {
                const exItem = list.querySelector(`[data-index="${q.exclusive}"]`);
                if (exItem) {
                  const cb = exItem.querySelector('input[type="checkbox"]');
                  if (cb) { cb.checked = false; exItem.classList.remove('selected'); }
                }
              }
              this.collectMultiResponse(qid, list, q);
            }

            if (q && q.maxSelect) {
              this.enforceMaxSelect(qid, list, q);
            }

            const block = item.closest('.question-block, .sub-question');
            if (block) block.classList.remove('has-error');
          });
        });
      });
    });

    this.container.querySelectorAll('.likert-radio').forEach(radio => {
      radio.addEventListener('change', () => {
        const name = radio.name;
        const [qid, rowStr] = name.split(/_(\d+)$/);
        const row = parseInt(rowStr);
        const val = parseInt(radio.value);
        let resp = this.getResponse(qid) || {};
        const q = this.findQuestion(qid);
        // 순위 매트릭스: uniqueColumns 값은 한 행에만 (중복 시 이전 행 해제)
        if (q && Array.isArray(q.uniqueColumns) && q.uniqueColumns.includes(val)) {
          for (const otherRow of Object.keys(resp)) {
            if (parseInt(otherRow) !== row && resp[otherRow] === val) {
              delete resp[otherRow];
              const otherRadio = this.container.querySelector(`input[name="${qid}_${otherRow}"][value="${val}"]`);
              if (otherRadio) otherRadio.checked = false;
            }
          }
        }
        resp[row] = val;
        this.setResponse(qid, resp);

        const table = radio.closest('.likert-table');
        if (table) table.classList.remove('has-error');
      });
    });

    // AHP 쌍대비교
    this.container.querySelectorAll('.ahp-block').forEach(block => {
      const qid = block.dataset.qid;
      block.querySelectorAll('input[type="radio"]').forEach(r => {
        r.addEventListener('change', () => {
          this.collectAhp(qid);
          block.classList.remove('has-error');
        });
      });
    });

    this.container.querySelectorAll('.text-input').forEach(el => {
      const qid = el.dataset.qid;
      el.addEventListener('input', () => {
        this.setResponse(qid, el.value);
        el.closest('.question-block')?.classList.remove('has-error');
      });
    });

    this.container.querySelectorAll('.other-text').forEach(el => {
      el.addEventListener('input', () => {
        const qid = el.dataset.qid;
        this.setResponse(qid, el.value);
      });
      el.addEventListener('click', (e) => e.stopPropagation());
    });
  }

  collectMultiResponse(qid, list) {
    const checked = [];
    list.querySelectorAll('input:checked').forEach(cb => {
      checked.push(cb.value === 'other' ? 'other' : parseInt(cb.value));
    });
    this.setResponse(qid, checked);
  }

  enforceMaxSelect(qid, list, q) {
    const checked = list.querySelectorAll('input:checked');
    const unchecked = list.querySelectorAll('input:not(:checked)');
    if (checked.length >= q.maxSelect) {
      unchecked.forEach(cb => {
        cb.disabled = true;
        cb.closest('.option-item')?.classList.add('disabled');
      });
    } else {
      list.querySelectorAll('input').forEach(cb => {
        cb.disabled = false;
        cb.closest('.option-item')?.classList.remove('disabled');
      });
    }
  }

  // ── Restore Saved Values ──
  restoreValues(section) {
    const allQuestions = this.getAllQuestions(section);
    for (const q of allQuestions) {
      const val = this.getResponse(q.id);
      if (val === undefined) continue;

      if (q.type === Q_TYPE.LIKERT_TABLE) {
        if (typeof val === 'object') {
          for (const [row, v] of Object.entries(val)) {
            const radio = this.container.querySelector(`input[name="${q.id}_${row}"][value="${v}"]`);
            if (radio) radio.checked = true;
          }
        }
      } else if (q.type === Q_TYPE.AHP_PAIRWISE) {
        if (val && val.pairs) {
          for (const [key, p] of Object.entries(val.pairs)) {
            const [i, j] = key.split('_');
            const wSel = p.winner === 'eq' ? 'eq' : p.winner;
            const wr = this.container.querySelector(`input[name="${q.id}_w_${i}_${j}"][value="${wSel}"]`);
            if (wr) wr.checked = true;
            if (p.winner !== 'eq' && p.intensity) {
              const sr = this.container.querySelector(`input[name="${q.id}_s_${i}_${j}"][value="${p.intensity}"]`);
              if (sr) sr.checked = true;
            }
          }
          this.collectAhp(q.id);
        }
      } else if (q.type === Q_TYPE.TEXT) {
        const el = this.container.querySelector(`[data-qid="${q.id}"]`);
        if (el) el.value = val;
      } else if (q.type === Q_TYPE.SINGLE || q.type === Q_TYPE.SINGLE_WITH_OTHER) {
        const list = this.container.querySelector(`.option-list[data-qid="${q.id}"]`);
        if (list) {
          const input = list.querySelector(`input[value="${val}"]`);
          if (input) {
            input.checked = true;
            input.closest('.option-item')?.classList.add('selected');
          }
        }
        if (val === 'other') {
          const otherText = this.getResponse(q.id + '_other');
          const otherInput = this.container.querySelector(`.other-text[data-qid="${q.id}_other"]`);
          if (otherInput && otherText) otherInput.value = otherText;
        }
      } else if (Array.isArray(val)) {
        const list = this.container.querySelector(`.option-list[data-qid="${q.id}"]`);
        if (list) {
          val.forEach(v => {
            const input = list.querySelector(`input[value="${v}"]`);
            if (input) {
              input.checked = true;
              input.closest('.option-item')?.classList.add('selected');
            }
          });
          if (q.maxSelect) this.enforceMaxSelect(q.id, list, q);
        }
        if (val.includes('other')) {
          const otherText = this.getResponse(q.id + '_other');
          const otherInput = this.container.querySelector(`.other-text[data-qid="${q.id}_other"]`);
          if (otherInput && otherText) otherInput.value = otherText;
        }
      }
    }
  }

  // ── Validation ──
  validateSection(section) {
    let valid = true;
    const allQuestions = this.getAllQuestions(section);

    for (const q of allQuestions) {
      if (q.optional) continue;

      const val = this.getResponse(q.id);
      let ok = true;

      if (q.type === Q_TYPE.LIKERT_TABLE) {
        const expected = q.items.length;
        ok = val && typeof val === 'object' && Object.keys(val).length === expected;
        if (!ok) {
          const table = this.container.querySelector(`.likert-table[data-qid="${q.id}"]`);
          table?.classList.add('has-error');
          this.showError(q.id, '모든 항목에 응답해 주십시오.');
        }
      } else if (q.type === Q_TYPE.AHP_PAIRWISE) {
        const n = q.elements.length;
        const need = n * (n - 1) / 2;
        const pairs = (val && val.pairs) || {};
        const answered = Object.keys(pairs).length === need &&
          Object.values(pairs).every(p => p.winner === 'eq' || p.intensity);
        if (!answered) {
          ok = false;
          this.showError(q.id, '모든 쌍을 비교해 주십시오.');
          this.container.querySelector(`.ahp-block[data-qid="${q.id}"]`)?.classList.add('has-error');
        } else if (n > 2 && val.cr >= 0.1) {
          ok = false;
          this.showError(q.id, `일관성비율(CR=${val.cr.toFixed(3)})이 0.1 이상입니다. 응답을 재검토해 주십시오.`);
          this.container.querySelector(`.ahp-block[data-qid="${q.id}"]`)?.classList.add('has-error');
        }
      } else if (q.type === Q_TYPE.TEXT) {
        ok = val && val.trim().length > 0;
        if (!ok) this.showError(q.id, '응답을 입력해 주십시오.');
        if (ok && q.pattern) {
          const re = new RegExp(q.pattern);
          if (!re.test(val.trim())) {
            ok = false;
            this.showError(q.id, q.patternMessage || '올바른 형식으로 입력해 주십시오.');
          }
        }
      } else if (q.type === Q_TYPE.SINGLE || q.type === Q_TYPE.SINGLE_WITH_OTHER) {
        ok = val !== undefined;
        if (!ok) this.showError(q.id, '하나를 선택해 주십시오.');
      } else if (Array.isArray(val)) {
        ok = val.length > 0;
        if (!ok) this.showError(q.id, '하나 이상 선택해 주십시오.');
      } else {
        ok = val !== undefined;
        if (!ok) this.showError(q.id, '응답해 주십시오.');
      }

      if (!ok) {
        valid = false;
        const block = this.container.querySelector(`[data-qid="${q.id}"]`);
        block?.classList.add('has-error');
      }
    }

    if (!valid) {
      const firstError = this.container.querySelector('.has-error');
      firstError?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    return valid;
  }

  showError(qid, msg) {
    const el = this.container.querySelector(`[data-error="${qid}"]`);
    if (el) el.textContent = msg;
  }

  // ── Helpers ──
  getAllQuestions(section) {
    const result = [];
    for (const q of section.questions) {
      if (q.type === Q_TYPE.SUB_QUESTIONS) {
        for (const sq of q.subQuestions) result.push(sq);
      } else {
        result.push(q);
      }
    }
    return result;
  }

  findQuestion(qid) {
    for (const s of sections) {
      for (const q of s.questions) {
        if (q.id === qid) return q;
        if (q.type === Q_TYPE.SUB_QUESTIONS) {
          for (const sq of q.subQuestions) {
            if (sq.id === qid) return sq;
          }
        }
      }
    }
    return null;
  }

  escape(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  formatDateTime(isoStr) {
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return isoStr;
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const mi = String(d.getMinutes()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
    } catch { return isoStr; }
  }

  // ── Completion ──
  renderCompletion() {
    if (this.token && (!this.submitted || this.editMode === EDIT_MODE.EDIT)) {
      this.submitToServer();
      return;
    }

    const statusBar = this.renderStatusBar();
    const alreadyMsg = this.submitted
      ? '<p class="resubmit-note">이전 응답이 업데이트되었습니다.</p>'
      : '';

    this.container.innerHTML = `
      ${statusBar}
      <div class="survey-container with-status-bar">
        <div class="completion">
          <div class="completion-icon">
            <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
          </div>
          <h2>설문이 완료되었습니다</h2>
          <p>제1차 조사에 응해 주셔서 진심으로 감사드립니다.<br/>
          수집된 결과는 통계 요약되어 2라운드(본인 응답 위치와 집단 분포 제공)에 활용되며, 위임 세부기준(별표·고시·운영가이드) 확정의 근거자료가 됩니다.</p>
          ${alreadyMsg}
          <button class="btn btn-next" id="btn-download" style="margin-top:32px">응답 데이터 다운로드 (JSON)</button>
        </div>
      </div>
    `;
    this.container.querySelector('#btn-download')?.addEventListener('click', () => {
      this.downloadResponses();
    });
  }

  async submitToServer() {
    const statusBar = this.renderStatusBar();
    this.container.innerHTML = `
      ${statusBar}
      <div class="survey-container with-status-bar">
        <div class="completion" style="padding:120px 20px">
          <div class="spinner" style="width:40px;height:40px;border:3px solid #e0e0e0;border-top:3px solid #2c2c2c;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 24px"></div>
          <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
          <h2>응답을 제출하고 있습니다…</h2>
        </div>
      </div>
    `;

    try {
      const res = await fetch(`${API_BASE}/api/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: this.token,
          survey_version: SURVEY_META.version || 'v1',
          responses: { ...this.responses },
        }),
      });

      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();

      this.submitted = true;
      const now = new Date().toISOString();
      if (data.status === 'created') this.submittedAt = now;
      else this.updatedAt = now;
      this.editMode = EDIT_MODE.NEW;
      this.renderCompletion();
    } catch (err) {
      const statusBar = this.renderStatusBar();
      this.container.innerHTML = `
        ${statusBar}
        <div class="survey-container with-status-bar">
          <div class="completion">
            <h2 style="color:var(--c-error)">제출 중 오류가 발생했습니다</h2>
            <p style="margin:16px 0">${err.message}<br/>응답은 브라우저에 저장되어 있습니다. 다시 시도하거나 JSON을 다운로드해 주십시오.</p>
            <button class="btn btn-next" id="btn-retry" style="margin:8px">다시 시도</button>
            <button class="btn btn-prev" id="btn-fallback" style="margin:8px">JSON 다운로드</button>
          </div>
        </div>
      `;
      this.container.querySelector('#btn-retry')?.addEventListener('click', () => this.submitToServer());
      this.container.querySelector('#btn-fallback')?.addEventListener('click', () => this.downloadResponses());
    }
  }

  downloadResponses() {
    const data = {
      meta: {
        survey: SURVEY_META.title,
        version: SURVEY_META.version || 'v1',
        submittedAt: new Date().toISOString(),
        idCode: this.responses['ID_CODE'] || '',
        token: this.token || '',
      },
      responses: { ...this.responses },
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `survey_${data.meta.idCode || 'anon'}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
