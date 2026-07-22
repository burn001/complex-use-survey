// 로컬 미리보기 전용 — 토큰 게이트/백엔드 없이 설문 UI를 렌더 (배포 대상 아님)
import './style.css';
import { SurveyEngine } from './survey.js';

class PreviewEngine extends SurveyEngine {
  constructor(container) {
    super(container); // 토큰 없음 → 게이트 DENIED로 시작
    // 게이트를 열고 가짜 응답자 주입
    this.participant = {
      name: '테스트 응답자',
      email: 'test@auri.re.kr',
      org: '건축공간연구원',
      phone: '010-0000-0000',
      category: '용도전환',
    };
    this.submitted = false;
    this.gate = 'open';
    this.currentPage = 0;
    this.render();
  }

  // 제출은 서버로 보내지 않고 완료 화면만
  async submitToServer() {
    this.submitted = true;
    this.submittedAt = new Date().toISOString();
    this.editMode = 'new';
    this.renderCompletion();
  }
}

const app = document.getElementById('app');
new PreviewEngine(app);
