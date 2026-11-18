# Plan-Do-See 다이어리 (과제 6)

계획(Plan) → 실행(Do) → 회고(See)를 서버 DB(SQLite)로 연결하는 다이어리. **로그인 기능이 없으므로 링크를 아는 사람은 누구나 볼 수 있습니다. 공개해도 괜찮은 내용만 입력하세요.** (접근 제어는 7번 과제)

## 실행
```bash
node --disable-warning=ExperimentalWarning server.js   # Node 22.13+ (node:sqlite 내장, 외부 패키지 없음)
# http://localhost:3000   (PORT, DB_PATH 환경변수로 변경)
npm test                                               # API 통과 기준 자동 검증
```

## 배포 (결과물 URL 만들기)
데이터가 새로고침/재시작 후에도 유지되려면 **DB 파일이 영속 디스크**에 있어야 합니다.
- Docker: `docker build -t pds . && docker run -p 8080:8080 -v pds-data:/data pds`
- Render/Fly/Railway 등: Node 22 런타임, Start Command `node --disable-warning=ExperimentalWarning server.js`,
  영속 디스크를 `/data`에 마운트하고 환경변수 `DB_PATH=/data/pds.db` 설정. (무료 플랜의 임시 디스크는 재배포 시 데이터가 사라집니다.)

## 구조
| 파일 | 역할 |
|---|---|
| `server.js` | HTTP 서버 + REST API(계획·할 일·실행 기록·회고·내보내기), 정적 파일 |
| `db.js` | SQLite 스키마 |
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
| C01 | 인증·로그인·쿠키·CAPTCHA 없음 |

## 직접 확인 순서 (제출 전)
1. 계획 1개+ → 할 일 5개+ → 실행 기록 3개+ 를 **본인의 실제 내용**으로 입력
2. 회고 화면의 숫자(0이 아님)를 눌러 근거 기록으로 이동되는지 확인
3. 완료 버튼 더블클릭 → 완료 기록 1건, 회고 완료 수 +1
4. 새로고침 → 값 유지, `내보내기`에서 파일 다운로드
5. 제목에 `<script>alert(1)</script>` 입력 → 그대로 텍스트로 보이는지 확인 후 삭제
