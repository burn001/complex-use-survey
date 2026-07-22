# 복합활용 설계기준 전문가 설문 시스템 (complex-use-survey)

「건축물의 복합용도 활성화 지원 특별법」 위임 세부기준 확정을 위한 전문가 조사 R1.
survey-system 템플릿 기반. **용도전환 델파이 + 적응형 AHP** 통합.

## 조사 구성 (frontend/src/questions.js)

- **PART 0 (공통)**: 응답자 정보 + 조사 분과 선택(P4: 용도전환 / 적응형 / 둘 다) — 분기 기준
- **PART A (용도전환)**: 11개 분야 타당성(A1) · 방향분류(A2) · 완화 우선순위(A3, 순위매트릭스) · 경계값/누락 자유기술(A4·A5)
- **PART B (적응형)**: 3대 영역 AHP(B1) · 전환성 하위 AHP(B2) · 경계값 적정성(B3) · 등급컷 적정성(B5) · 운영방식(B6) · 자유기술(B4·B7)
- **PART C (공통)**: 종합 의견

## 이번 구축에서 새로 구현한 것

- **`Q_TYPE.AHP_PAIRWISE`** — 쌍대비교(더 중요한 쪽 + 정도 1·3·5·7·9), **실시간 CR 계산·표시**, CR ≥ 0.1 시 제출 차단·재검토 유도. 기하평균 가중치 산출. (survey.js: `renderAhpPairwise`/`computeAhp`/`collectAhp`/`renderCr`, 검증·복원·CSS 포함)
- **일반화된 분기** — `showWhen: { questionId, values: [..] }` (기존 Q6 하드코딩 제거)
- **순위 매트릭스** — LIKERT_TABLE `uniqueColumns`로 1~4위 중복 방지
- **체크박스 이중토글 버그 수정** — 템플릿의 `input.checked = !input.checked` 제거, `requestAnimationFrame` 확정상태 동기화 (survey-system 스킬 경고 반영)
- **value=0 파싱 버그 수정** — 첫 옵션(0) 저장 시 문자열화 방지 → 분기 정상 동작

## 로컬 미리보기

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173/?token=<임의문자열>
```
- 설문 화면은 백엔드 토큰 검증을 거치므로, UI만 보려면 백엔드도 함께 띄우거나 `verifyToken` 게이트를 임시 우회.
- 백엔드:
```bash
cd backend
python -m venv .venv && . .venv/Scripts/activate
pip install -r requirements.txt
# .env.example → .env (MONGODB_URI, TOKEN_SECRET, ADMIN_KEY)
uvicorn main:app --reload --port 8000
```
- 프론트 빌드 검증: `npx vite build` (통과 확인됨).

## 배포 체크리스트 (검토 후 진행 — 아직 미배포)

신규(4번째) 시스템으로 편입:

| 항목 | 값 |
|---|---|
| 포트 | **8004** (8001 ai / 8002 small-housing / 8003 local-gov 다음) |
| DB | `complex_use_survey` (config.py 기본값 반영됨) |
| Caddy prefix | `/complex-use/*` → `localhost:8004` |
| 관리자 모델 | 단일 `ADMIN_KEY` (small-housing과 동일 최단 구성) 권장 |
| 컨테이너/레포 | `complex-use-survey` (신규 GitHub 레포 필요) |

배포 시 작업:
1. `docker-compose.yml` 호스트 포트 8004 매핑, 컨테이너/네트워크명 지정
2. `.env` 작성(SSH 배치): `MONGODB_URI`(winserver mongod), `TOKEN_SECRET`, `ADMIN_KEY`, `GMAIL_*`, `MONGODB_DB=complex_use_survey`, `CORS_ORIGINS`
3. `frontend/.env.production` = `VITE_API_BASE=https://alris.ddns.net:8443/complex-use`
4. Caddyfile에 `handle_path /complex-use/* { reverse_proxy localhost:8004 }` 한 블록 추가 + reload
5. `.github/workflows/deploy-pages.yml` base 경로·admin/questions.js 복사 확인
6. 전문가 패널 xlsx 수령 → `scripts/import_participants.py <xlsx> --db complex_use_survey` (패널 2종: 용도전환/적응형 category 구분)
7. 헬스체크: `curl -sk https://alris.ddns.net:8443/complex-use/api/health`

## 운영 메모

- **패널 분리**: 초대 시 category로 용도전환/적응형 구분 → P4 분과 선택과 정합. 인벤토리·토큰·배포 흐름은 `auri-survey` 스킬 참조.
- **R1 이후**: 응답 통계(중앙값·수렴도·CVR / AHP 그룹 가중치) 집계 → R2에서 "본인 응답+집단 분포" 재제시(라운드 피드백)는 후속 개발 항목.
- 설계 근거 문서: 상위 폴더 `01_전문가설문 설계서` / `02·03 문항 hwpx`.
