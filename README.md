# Plan-Do-See 다이어리 (과제 6 → 과제 7: 회원 인증·인가·세션)

계획(Plan) → 실행(Do) → 회고(See)를 서버 DB(PostgreSQL)로 연결하는 다이어리. **7번에서 회원 가입·로그인·로그아웃, 세션, 사용자별 접근 제어를 붙였습니다.** 첫 화면은 로그인 화면이고, 내 기록은 로그인한 나에게만 보입니다. 설명서: [`docs/auth-design.md`](docs/auth-design.md) · 검증 기록: [`docs/evidence.md`](docs/evidence.md)

## 실행
```bash
npm install
export DATABASE_URL='postgres://USER:PASSWORD@HOST/DBNAME?sslmode=require'   # PostgreSQL 접속 문자열 (코드에 적지 않음)
# 선택: SESSION_TTL_SECONDS(기본 3600), COOKIE_SECURE=1(HTTPS 프록시 헤더가 없을 때), BCRYPT_COST(기본 12)
npm start            # http://localhost:3000  (PORT 환경변수로 변경)
```
테이블은 서버 시작 시 자동 생성·갱신됩니다(`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`). 6번에서 만든 기존 기록은 소유자가 없어 아무에게도 안 보이므로, 가입한 뒤 내 계정으로 이관합니다:
```bash
DATABASE_URL='...' node scripts/claim-legacy-data.js <내 아이디>
```

테스트(로컬 PostgreSQL 필요, 테스트 전용 스키마를 만들었다가 지움):
```bash
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres npm test
```

## 배포 (결과물 URL 만들기) — 무료 구성
서버가 재시작·재배포·잠자기 후 깨어나도 데이터가 유지되도록 **DB는 서버 밖의 PostgreSQL**을 씁니다.
1. 무료 PostgreSQL(예: Neon) 프로젝트를 만들고 접속 문자열(`postgresql://...?sslmode=require`)을 복사
2. Render 등에서 Web Service 생성: 이 저장소 연결, Docker(또는 Node) 런타임
3. 서비스 환경변수에 `DATABASE_URL` = 위 접속 문자열 (비밀값이므로 저장소에는 절대 커밋하지 않음)
4. 배포 후 `https://<서비스>.onrender.com` 이 결과물 URL

## 구조
| 파일 | 역할 |
|---|---|
| `server.js` | HTTP 서버 + REST API(계획·할 일·실행 기록·회고·내보내기), 정적 파일 |
| `db.js` | PostgreSQL 연결·스키마(회원·세션·소유자 컬럼 포함) |
| `scripts/verify-access.js` | 접근 제어·세션 검증 → `docs/evidence.md` 생성 |
| `scripts/claim-legacy-data.js` | 6번 기존 기록을 내 계정으로 이관 |
| `public/` | 화면(순수 JS, 사용자 입력은 `textContent`로만 렌더링) |
| `contracts/pds-schema-v2.json` | 테이블·컬럼·관계·날짜 규칙 |
| `test/smoke.test.js` | 통과 기준 자동 검증 |

## 통과 기준 대응
| 기준 | 구현 |
|---|---|
| C04–C08 | `plans`(기간·우선순위·성공 기준·예상 시간), `plan_revisions`(rev 0 = 최초 계획 보존) |
| C09–C20 | 할 일 CRUD·완료/완료 취소·마감일·우선순위·태그·예상 시간·검색·필터·정렬(서버 처리, 화면에 정렬 기준 표시, 동률은 ID 오름차순) |
| C21–C22 | `completions.task_id UNIQUE` + `idempotency_key UNIQUE`. 버튼 비활성화가 아니라 DB 제약+멱등성 키로 방지 |
| C23–C27 | `runs` 별도 테이블(시작·종료·소요(분)·막힘 사유, 할 일에 연결). 계획/할 일 값 불변 |
| C28–C33, C83 | `/api/retro` 집계, 각 값은 `/api/retro/evidence`(근거 기록 화면)로 이동, 개선점 → 다음 계획 반영 |
| C34–C36, C78–C82 | 서버 DB 저장, 재시작 후 동일, `/api/export` 파일 1개, 첫 화면 공개 범위 문구 |
| C57–C58 | 사용자 입력을 HTML로 해석하지 않음 + CSP(`script-src 'self'`), 코드·설정에 비밀값 없음(`.env`는 gitignore) |
| 7번 | 가입·로그인·로그아웃·세션·소유자별 접근 제어 (`docs/auth-design.md`) |

## 직접 확인 순서 (제출 전)
0. 계정 두 개를 만들어 서로의 자료가 안 보이는지 확인 (`TEST_DATABASE_URL=... node scripts/verify-access.js`로 자동 검증)
1. 계획 1개+ → 할 일 5개+ → 실행 기록 3개+ 를 **본인의 실제 내용**으로 입력
2. 회고 화면의 숫자(0이 아님)를 눌러 근거 기록으로 이동되는지 확인
3. 완료 버튼 더블클릭 → 완료 기록 1건, 회고 완료 수 +1
4. 새로고침 → 값 유지, `내보내기`에서 파일 다운로드
5. 제목에 `<script>alert(1)</script>` 입력 → 그대로 텍스트로 보이는지 확인 후 삭제
