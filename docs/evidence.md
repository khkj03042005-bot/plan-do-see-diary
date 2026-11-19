# 접근 제어·세션 검증 기록

실행 시각: 2026-11-19T00:58:12.943Z  
대상: `로컬 서버 + 임시 PostgreSQL 스키마`  
비밀번호·세션 토큰은 `***` / `<masked>` 로 가렸습니다. 아래 표의 기준 번호는 과제 7 통과 기준입니다.

| 결과 | 기준 | 내용 |
|---|---|---|
| PASS | T07-C94 | 가입 화면(API)에서 새 계정을 만들 수 있다 |
| PASS | T07-C116 | 계정 2개를 만들고 각자 자료(계획·할 일·실행 기록·완료·회고)를 넣었다 |
| PASS | T07-C117 | A가 B의 자료(계획·할 일)를 읽으려는 요청이 거절된다 |
| PASS | T07-C118 | A가 B의 자료를 고치려는 요청(계획·할 일 수정, 완료 처리, 남의 계획 밑에 쓰기)이 모두 거절된다 |
| PASS | T07-C119 | A가 B의 자료를 지우려는 요청이 거절된다 |
| PASS | T07-C120 | 반대 방향(B→A)도 읽기·수정·삭제가 똑같이 거절된다 |
| PASS | T07-C121 | 거절은 403 또는 존재 자체를 숨기는 404다(이 앱은 404) |
| PASS | T07-C122 | 거절 앞뒤 자료 건수가 같고, 반대편에 새로 생긴 자료(INJECT)·변조(HACKED)가 없다 |
| PASS | T07-C123 | 주소·헤더·본문에 B를 적어 보내도 돌아온 것은 A의 자료뿐이고, 만들어진 것은 A의 계정에 속하며 B의 자료는 변하지 않는다 |
| PASS | T07-C124 | 로그인하지 않은 채 자료를 직접 요청하면 모두 401로 거절된다 |
| PASS | T07-C97 | 로그인하지 않은 채 내 자료 화면 주소(/)를 열면 자료 대신 로그인 화면(/login)으로 이동한다 |
| PASS | T07-C03 | 첫 화면은 로그인 화면이고, 계정을 만들지 않아도 열린다(내 기록은 로그인 뒤에만 보임) |
| PASS | T07-EXTRA | 상태를 바꾸는 요청에 X-Requested-With 헤더가 없으면 400으로 거절된다 |
| PASS | T07-C125 | A의 계획·할 일·실행 기록·회고·근거·내보내기 응답, 검색·필터 결과 어디에도 B 자료가 하나도 없다 |
| PASS | T07-C95 | 만든 계정으로 로그인할 수 있다 |
| PASS | T07-C96 | 로그아웃할 수 있다(서버에서 세션이 지워진다) |
| PASS | T07-C109 | 로그인 상태의 성공 응답(200)과, 로그아웃 뒤 같은 값으로 다시 요청했을 때의 거절 응답(401)이 나란히 있다 |
| PASS | T07-C110 | 두 요청의 주소·방식이 같고 달라진 것은 로그아웃 여부뿐이다 |
| PASS | T07-C108 | 로그인 뒤 사용자 식별은 세션(서버 저장 토큰)으로 한다 |
| PASS | T07-C111 | 세션에 만료 시각이 있고 유효 기간(3600초=1시간)이 쿠키 Max-Age와 DB expires_at 에 기록된다 |
| PASS | T07-C112 | 세션 값이 URL에 포함되지 않는다 |
| PASS | T07-EXPIRY | 만료 시각이 지난 세션은 쿠키가 남아 있어도 서버가 거절한다(401) |
| PASS | T07-C114 | 비밀번호를 바꾸면 이전에 발급된 세션과 옛 비밀번호는 더 이상 통하지 않는다 |
| PASS | T07-C98 | 같은 아이디로 두 번 가입되지 않는다(409) |
| PASS | T07-C99 | 비밀번호만 틀렸을 때와 아이디가 없을 때의 안내 문구·상태 코드가 같다 |
| PASS | T07-C103 | 계정 하나의 비밀번호가 DB에 저장된 모습(bcrypt 해시)이 기록에 있고, 입력한 글자가 그대로 보이지 않는다 |
| PASS | T07-C104 | 같은 비밀번호로 만든 두 계정의 저장값이 서로 다르다(계정마다 다른 솔트) |
| PASS | T07-C113 | 세션 토큰은 DB에 SHA-256 해시로만 저장되고(원문 없음), 서명용 비밀키가 필요 없는 구조라 코드·배포 파일·Git 어디에도 비밀키가 없다 |
| PASS | T07-C113b | 브라우저 코드·배포 파일에 하드코딩된 비밀값 패턴이 없다 |
| PASS | T07-C133 | 내 자료 전체를 파일 하나로 내보낼 수 있고, 내 자료만 들어 있으며 비밀번호·세션 값이 없다 |
| PASS | T07-C134 | 계정을 지우면 내 자료도 함께 지워지고(DB에 남은 행 0), 그 안내가 화면(계정 메뉴)에 적혀 있다 |
| PASS | T07-C126 | 거절을 만드는 소스 위치(WHERE ... user_id = ? 조건, uid(), 로그인 확인)가 위에 줄 번호와 함께 있다 |
| PASS | T07-C105 | 로그인 요청·응답을 적은 이 기록에 비밀번호 원문이 남아 있지 않다 |
| PASS | T07-C106 | 서버 출력(로그)·모든 네트워크 응답 어디에도 비밀번호 원문이 없다 |
| PASS | T07-C46/C131 | 이 증거 파일에 비밀번호·세션 토큰 원문이 없다(마스킹 후 재검사) |

---

## 0. 계정 두 개 만들고 각자 자료 넣기 (T07-C116, C94)

**A 가입**
- 요청: `POST /api/signup` 쿠키:없음 본문:`{"username":"alice_f033a1","password":"***"}`
- 응답: `201` Set-Cookie: sid=<masked> `{"ok":true,"username":"alice_f033a1"}`

> PASS · T07-C94 · 가입 화면(API)에서 새 계정을 만들 수 있다

**B 가입**
- 요청: `POST /api/signup` 쿠키:없음 본문:`{"username":"bob_f033a1","password":"***"}`
- 응답: `201` Set-Cookie: sid=<masked> `{"ok":true,"username":"bob_f033a1"}`

A 자료 건수 {"plans":1,"revisions":1,"tasks":2,"runs":1,"completions":1,"notes":1} / B 자료 건수 {"plans":1,"revisions":1,"tasks":2,"runs":1,"completions":1,"notes":1} (비밀번호는 기록하지 않음)

> PASS · T07-C116 · 계정 2개를 만들고 각자 자료(계획·할 일·실행 기록·완료·회고)를 넣었다

## 1. A로 로그인한 채 B의 자료 읽기·수정·삭제 (C117~C119, C121)

**A→B 계획 읽기**
- 요청: `GET /api/plans/2` 쿠키:있음(sid=<masked>)
- 응답: `404` `{"error":"계획을 찾을 수 없습니다."}`

**A→B 할 일 읽기**
- 요청: `GET /api/tasks/3` 쿠키:있음(sid=<masked>)
- 응답: `404` `{"error":"할 일을 찾을 수 없습니다."}`

> PASS · T07-C117 · A가 B의 자료(계획·할 일)를 읽으려는 요청이 거절된다

**A→B 계획 수정**
- 요청: `PUT /api/plans/2` 쿠키:있음(sid=<masked>) 본문:`{"title":"HACKED","period_start":"2026-11-16","period_end":"2026-11-22","priority":"low","success_criteria":"x","estimated_minutes":1}`
- 응답: `404` `{"error":"계획을 찾을 수 없습니다."}`

**A→B 할 일 수정**
- 요청: `PUT /api/tasks/3` 쿠키:있음(sid=<masked>) 본문:`{"title":"HACKED","priority":"low","estimated_minutes":1}`
- 응답: `404` `{"error":"할 일을 찾을 수 없습니다."}`

**A→B 할 일 완료 처리**
- 요청: `POST /api/tasks/4/complete` 쿠키:있음(sid=<masked>) 본문:`{"idempotency_key":"steal"}`
- 응답: `404` `{"error":"할 일을 찾을 수 없습니다."}`

**A→B 계획 아래 새 할 일 만들기**
- 요청: `POST /api/tasks` 쿠키:있음(sid=<masked>) 본문:`{"plan_id":2,"title":"INJECT","priority":"low","estimated_minutes":1}`
- 응답: `404` `{"error":"계획을 찾을 수 없습니다."}`

**A→B 할 일에 실행 기록 만들기**
- 요청: `POST /api/runs` 쿠키:있음(sid=<masked>) 본문:`{"task_id":4,"started_at":"2026-11-17T01:00:00Z","ended_at":"2026-11-17T02:00:00Z"}`
- 응답: `404` `{"error":"할 일을 찾을 수 없습니다."}`

**A→B 회고 메모 반영**
- 요청: `POST /api/retro/notes/2/apply` 쿠키:있음(sid=<masked>) 본문:`{}`
- 응답: `404` `{"error":"개선점을 찾을 수 없습니다."}`

**A→B 회고 메모 쓰기**
- 요청: `POST /api/retro/notes` 쿠키:있음(sid=<masked>) 본문:`{"plan_id":2,"note":"INJECT"}`
- 응답: `404` `{"error":"계획을 찾을 수 없습니다."}`

> PASS · T07-C118 · A가 B의 자료를 고치려는 요청(계획·할 일 수정, 완료 처리, 남의 계획 밑에 쓰기)이 모두 거절된다

**A→B 실행 기록 삭제**
- 요청: `DELETE /api/runs/2` 쿠키:있음(sid=<masked>)
- 응답: `404` `{"error":"실행 기록을 찾을 수 없습니다."}`

**A→B 할 일 삭제**
- 요청: `DELETE /api/tasks/3` 쿠키:있음(sid=<masked>)
- 응답: `404` `{"error":"할 일을 찾을 수 없습니다."}`

**A→B 계획 삭제**
- 요청: `DELETE /api/plans/2` 쿠키:있음(sid=<masked>)
- 응답: `404` `{"error":"계획을 찾을 수 없습니다."}`

> PASS · T07-C119 · A가 B의 자료를 지우려는 요청이 거절된다

## 2. 반대 방향: B로 A의 자료 읽기·수정·삭제 (C120)

**B→A 계획 읽기**
- 요청: `GET /api/plans/1` 쿠키:있음(sid=<masked>)
- 응답: `404` `{"error":"계획을 찾을 수 없습니다."}`

**B→A 계획 수정**
- 요청: `PUT /api/plans/1` 쿠키:있음(sid=<masked>) 본문:`{"title":"HACKED","period_start":"2026-11-16","period_end":"2026-11-22","priority":"low","success_criteria":"x","estimated_minutes":1}`
- 응답: `404` `{"error":"계획을 찾을 수 없습니다."}`

**B→A 할 일 삭제**
- 요청: `DELETE /api/tasks/1` 쿠키:있음(sid=<masked>)
- 응답: `404` `{"error":"할 일을 찾을 수 없습니다."}`

**B→A 실행 기록 삭제**
- 요청: `DELETE /api/runs/1` 쿠키:있음(sid=<masked>)
- 응답: `404` `{"error":"실행 기록을 찾을 수 없습니다."}`

**B→A 계획 삭제**
- 요청: `DELETE /api/plans/1` 쿠키:있음(sid=<masked>)
- 응답: `404` `{"error":"계획을 찾을 수 없습니다."}`

> PASS · T07-C120 · 반대 방향(B→A)도 읽기·수정·삭제가 똑같이 거절된다

> PASS · T07-C121 · 거절은 403 또는 존재 자체를 숨기는 404다(이 앱은 404)

## 3. 거절 앞뒤 자료 건수 비교 (C122)

- A: 전 {"plans":1,"revisions":1,"tasks":2,"runs":1,"completions":1,"notes":1} → 후 {"plans":1,"revisions":1,"tasks":2,"runs":1,"completions":1,"notes":1}
- B: 전 {"plans":1,"revisions":1,"tasks":2,"runs":1,"completions":1,"notes":1} → 후 {"plans":1,"revisions":1,"tasks":2,"runs":1,"completions":1,"notes":1}
- B 할 일 제목(변조·삽입 없음): ["BOB-f033a1-task1","BOB-f033a1-task2"]

> PASS · T07-C122 · 거절 앞뒤 자료 건수가 같고, 반대편에 새로 생긴 자료(INJECT)·변조(HACKED)가 없다

## 4. 주소·헤더·본문에 다른 계정을 적어 보내기 (C123)

**A가 주소·헤더에 B를 적어 계획 목록 요청**
- 요청: `GET /api/plans?user_id=2&username=bob_f033a1` 쿠키:있음(sid=<masked>) 추가헤더:`{"X-User-Id":"2","X-Username":"bob_f033a1","X-Forwarded-User":"bob_f033a1"}`
- 응답: `200` `(본문 생략)`

**A가 본문에 user_id=B 를 적어 계획 생성**
- 요청: `POST /api/plans` 쿠키:있음(sid=<masked>) 본문:`{"title":"ALICE-f033a1-spoof","user_id":2,"owner":"bob_f033a1","period_start":"2026-11-16","period_end":"2026-11-22","priority":"low","success_criteria":"x","estimated_minutes":1}` (user_id 값은 B의 id)
- 응답: `201` `{"id":3,"title":"ALICE-f033a1-spoof","period_start":"2026-11-16","period_end":"2026-11-22","priority":"low","success_criteria":"x","estimated_minutes":1,"improvement_note_id":null,"created_at":"2026-11-19T00:58:08.308Z","updated_at":"2026-11-19T00:58:08.308Z","revisions":[{"id":3,"plan_id":3,"revisi`

> PASS · T07-C123 · 주소·헤더·본문에 B를 적어 보내도 돌아온 것은 A의 자료뿐이고, 만들어진 것은 A의 계정에 속하며 B의 자료는 변하지 않는다

## 5. 로그인하지 않은 직접 요청 (C124) / 화면 (C97, C03)

**비로그인 GET /api/plans**
- 요청: `GET /api/plans` 쿠키:없음
- 응답: `401` `{"error":"로그인이 필요합니다."}`

**비로그인 GET /api/plans/2**
- 요청: `GET /api/plans/2` 쿠키:없음
- 응답: `401` `{"error":"로그인이 필요합니다."}`

**비로그인 GET /api/tasks**
- 요청: `GET /api/tasks` 쿠키:없음
- 응답: `401` `{"error":"로그인이 필요합니다."}`

**비로그인 GET /api/runs**
- 요청: `GET /api/runs` 쿠키:없음
- 응답: `401` `{"error":"로그인이 필요합니다."}`

**비로그인 GET /api/retro**
- 요청: `GET /api/retro` 쿠키:없음
- 응답: `401` `{"error":"로그인이 필요합니다."}`

**비로그인 GET /api/export**
- 요청: `GET /api/export` 쿠키:없음
- 응답: `401` `{"error":"로그인이 필요합니다."}`

**비로그인 PUT /api/tasks/3**
- 요청: `PUT /api/tasks/3` 쿠키:없음 본문:`{"title":"x","priority":"low","estimated_minutes":1}`
- 응답: `401` `{"error":"로그인이 필요합니다."}`

**비로그인 DELETE /api/tasks/3**
- 요청: `DELETE /api/tasks/3` 쿠키:없음
- 응답: `401` `{"error":"로그인이 필요합니다."}`

**비로그인 POST /api/runs**
- 요청: `POST /api/runs` 쿠키:없음 본문:`{}`
- 응답: `401` `{"error":"로그인이 필요합니다."}`

> PASS · T07-C124 · 로그인하지 않은 채 자료를 직접 요청하면 모두 401로 거절된다

**비로그인 내 자료 화면 /**
- 요청: `GET /` 쿠키:없음
- 응답: `302` `(본문 생략)`

> PASS · T07-C97 · 로그인하지 않은 채 내 자료 화면 주소(/)를 열면 자료 대신 로그인 화면(/login)으로 이동한다

> PASS · T07-C03 · 첫 화면은 로그인 화면이고, 계정을 만들지 않아도 열린다(내 기록은 로그인 뒤에만 보임)

**CSRF 방어: 필수 헤더 없이 POST**
- 요청: `POST /api/plans` 쿠키:있음(sid=<masked>) 본문:`{"title":"x"}`
- 응답: `400` `{"error":"잘못된 요청입니다."}`

> PASS · T07-EXTRA · 상태를 바꾸는 요청에 X-Requested-With 헤더가 없으면 400으로 거절된다

## 6. 목록·집계·내보내기 응답에 다른 계정 자료가 섞이지 않는지 (C125)

**A /api/plans**
- 요청: `GET /api/plans` 쿠키:있음(sid=<masked>)
- 응답: `200` `(본문 생략)`

**A /api/tasks**
- 요청: `GET /api/tasks` 쿠키:있음(sid=<masked>)
- 응답: `200` `(본문 생략)`

**A /api/runs**
- 요청: `GET /api/runs` 쿠키:있음(sid=<masked>)
- 응답: `200` `(본문 생략)`

**A /api/retro**
- 요청: `GET /api/retro` 쿠키:있음(sid=<masked>)
- 응답: `200` `(본문 생략)`

**A /api/retro/evidence?metric=blocked**
- 요청: `GET /api/retro/evidence?metric=blocked` 쿠키:있음(sid=<masked>)
- 응답: `200` `(본문 생략)`

**A /api/retro/evidence?metric=actual_minutes**
- 요청: `GET /api/retro/evidence?metric=actual_minutes` 쿠키:있음(sid=<masked>)
- 응답: `200` `(본문 생략)`

**A /api/export**
- 요청: `GET /api/export` 쿠키:있음(sid=<masked>)
- 응답: `200` `(본문 생략)`

**A가 B 제목으로 검색**
- 요청: `GET /api/tasks?q=BOB-f033a1` 쿠키:있음(sid=<masked>)
- 응답: `200` `{"sort":"due_date","dir":"asc","tie_breaker":"id asc","tasks":[]}`

**A가 B의 계획 id로 필터**
- 요청: `GET /api/tasks?plan_id=2` 쿠키:있음(sid=<masked>)
- 응답: `200` `{"sort":"due_date","dir":"asc","tie_breaker":"id asc","tasks":[]}`

> PASS · T07-C125 · A의 계획·할 일·실행 기록·회고·근거·내보내기 응답, 검색·필터 결과 어디에도 B 자료가 하나도 없다

## 7. 세션·로그아웃·비밀번호 변경 (C95, C96, C108~C115)

**A 로그인**
- 요청: `POST /api/login` 쿠키:없음 본문:`{"username":"alice_f033a1","password":"***"}`
- 응답: `200` Set-Cookie: sid=<masked> `{"ok":true,"username":"alice_f033a1"}`

> PASS · T07-C95 · 만든 계정으로 로그인할 수 있다

**로그인 상태: GET /api/plans**
- 요청: `GET /api/plans` 쿠키:있음(sid=<masked>)
- 응답: `200` `(본문 생략)`

**로그아웃**
- 요청: `POST /api/logout` 쿠키:있음(sid=<masked>)
- 응답: `200` Set-Cookie: sid=<masked> `{"ok":true}`

**로그아웃 뒤 같은 쿠키 값으로 같은 요청**
- 요청: `GET /api/plans` 쿠키:있음(sid=<masked>)
- 응답: `401` `{"error":"로그인이 필요합니다."}`

> PASS · T07-C96 · 로그아웃할 수 있다(서버에서 세션이 지워진다)

> PASS · T07-C109 · 로그인 상태의 성공 응답(200)과, 로그아웃 뒤 같은 값으로 다시 요청했을 때의 거절 응답(401)이 나란히 있다

> PASS · T07-C110 · 두 요청의 주소·방식이 같고 달라진 것은 로그아웃 여부뿐이다

> PASS · T07-C108 · 로그인 뒤 사용자 식별은 세션(서버 저장 토큰)으로 한다

- DB sessions 예시: created_at=2026-11-19T00:58:08.144Z

> PASS · T07-C111 · 세션에 만료 시각이 있고 유효 기간(3600초=1시간)이 쿠키 Max-Age와 DB expires_at 에 기록된다

> PASS · T07-C112 · 세션 값이 URL에 포함되지 않는다

**만료 시각이 지난 세션으로 요청(DB의 expires_at 을 과거로 바꿈)**
- 요청: `GET /api/plans` 쿠키:있음(sid=<masked>)
- 응답: `401` `{"error":"로그인이 필요합니다."}`

> PASS · T07-EXPIRY · 만료 시각이 지난 세션은 쿠키가 남아 있어도 서버가 거절한다(401)

**B 비밀번호 변경**
- 요청: `POST /api/password` 쿠키:있음(sid=<masked>) 본문:`{"old_password":"***","new_password":"***"}`
- 응답: `200` Set-Cookie: sid=<masked> `{"ok":true,"message":"비밀번호가 변경되었습니다. 다시 로그인하세요."}`

**변경 전에 발급된 다른 세션으로 요청**
- 요청: `GET /api/plans` 쿠키:있음(sid=<masked>)
- 응답: `401` `{"error":"로그인이 필요합니다."}`

**옛 비밀번호로 로그인**
- 요청: `POST /api/login` 쿠키:없음 본문:`{"username":"bob_f033a1","password":"***"}`
- 응답: `401` `{"error":"아이디 또는 비밀번호가 올바르지 않습니다."}`

> PASS · T07-C114 · 비밀번호를 바꾸면 이전에 발급된 세션과 옛 비밀번호는 더 이상 통하지 않는다

## 8. 가입 중복 / 로그인 실패 문구 (C98, C99)

**같은 아이디 재가입**
- 요청: `POST /api/signup` 쿠키:없음 본문:`{"username":"alice_f033a1","password":"***"}`
- 응답: `409` `{"error":"이미 사용 중인 아이디입니다."}`

> PASS · T07-C98 · 같은 아이디로 두 번 가입되지 않는다(409)

**아이디는 맞고 비밀번호가 틀림**
- 요청: `POST /api/login` 쿠키:없음 본문:`{"username":"alice_f033a1","password":"***"}`
- 응답: `401` `{"error":"아이디 또는 비밀번호가 올바르지 않습니다."}`

**없는 아이디**
- 요청: `POST /api/login` 쿠키:없음 본문:`{"username":"nobody_f033a1","password":"***"}`
- 응답: `401` `{"error":"아이디 또는 비밀번호가 올바르지 않습니다."}`

> PASS · T07-C99 · 비밀번호만 틀렸을 때와 아이디가 없을 때의 안내 문구·상태 코드가 같다

## 9. 비밀번호 저장 (C101~C107)

- DB 저장값(계정 A): `$2b$12$MmmKn708Ruoz5CuFE4vpE.arVZLnzv9yUpfSUh/Dv0IQWFZCVJLhm`  ← bcrypt 해시(형식 $2a/$2b$비용$솔트+해시)

- 같은 비밀번호로 만든 두 계정의 저장값:
  - `$2b$12$EEZ2YTbhrzpQ.aMUGgFlDOHK4rxZjG2qexItusv/afYhe6x0xcFdG`
  - `$2b$12$QXOB78ywWCvWf4JhPfvjF.Jq/v2uMGrcwy7awj0QWQx9zrv8WiOAm`

> PASS · T07-C103 · 계정 하나의 비밀번호가 DB에 저장된 모습(bcrypt 해시)이 기록에 있고, 입력한 글자가 그대로 보이지 않는다

> PASS · T07-C104 · 같은 비밀번호로 만든 두 계정의 저장값이 서로 다르다(계정마다 다른 솔트)

> PASS · T07-C113 · 세션 토큰은 DB에 SHA-256 해시로만 저장되고(원문 없음), 서명용 비밀키가 필요 없는 구조라 코드·배포 파일·Git 어디에도 비밀키가 없다

> PASS · T07-C113b · 브라우저 코드·배포 파일에 하드코딩된 비밀값 패턴이 없다

## 10. 내보내기 · 계정 삭제 (C133, C134)

**A 내보내기**
- 요청: `GET /api/export` 쿠키:있음(sid=<masked>)
- 응답: `200` `(본문 생략)`

> PASS · T07-C133 · 내 자료 전체를 파일 하나로 내보낼 수 있고, 내 자료만 들어 있으며 비밀번호·세션 값이 없다

**A 계정 삭제**
- 요청: `POST /api/account/delete` 쿠키:있음(sid=<masked>) 본문:`{"password":"***"}`
- 응답: `200` Set-Cookie: sid=<masked> `{"ok":true,"message":"계정과 모든 기록이 삭제되었습니다."}`

**삭제 뒤 A 세션으로 요청**
- 요청: `GET /api/plans` 쿠키:없음
- 응답: `401` `{"error":"로그인이 필요합니다."}`

- 삭제 뒤 DB에 남은 A의 자료 행 수: 0

> PASS · T07-C134 · 계정을 지우면 내 자료도 함께 지워지고(DB에 남은 행 0), 그 안내가 화면(계정 메뉴)에 적혀 있다

## 11. 거절을 만드는 소스 위치 (C126)

- `server.js:91` `async function userFromReq(req) {`
- `server.js:134` `if (!user) throw new HttpError(401, '로그인이 필요합니다.');`
- `server.js:138` `if (!user) throw new HttpError(401, '로그인이 필요합니다.');`
- `server.js:146` `if (!user) throw new HttpError(401, '로그인이 필요합니다.');`
- `server.js:155` `const getPlan = async (id) => { const p = await get('SELECT * FROM plans WHERE id = ? AND user_id = ?', id, uid()); if (!p) throw new HttpError(404, '`
- `server.js:175` `await run('UPDATE plans SET title=?, period_start=?, period_end=?, priority=?, success_criteria=?, estimated_minutes=?, updated_at=? WHERE id=? AND us`
- `server.js:183` `async function taskRows(where = '1=1', params = [], order = 't.id ASC') {`
- `server.js:241` `await run('UPDATE tasks SET title=?, due_date=?, priority=?, estimated_minutes=?, status=?, updated_at=? WHERE id=? AND user_id=?', f.title, f.due_dat`
- `server.js:252` `const ins = await run('INSERT INTO completions (task_id, idempotency_key, completed_at, user_id) VALUES (?,?,?,?) ON CONFLICT DO NOTHING', id, key, no`
- `server.js:257` `async function deleteTask(id) { await getTask(id); await run('DELETE FROM tasks WHERE id = ? AND user_id = ?', id, uid()); return { deleted: true }; }`
- `server.js:260` `async function listRuns(q) {`
- `server.js:276` `const r = await run('DELETE FROM runs WHERE id = ? AND user_id = ?', id, uid());`
- `server.js:282` `async function scopePlans(q) {`
- `server.js:377` `['DELETE', /^\/api\/plans\/(\d+)$/, async (m) => { await getPlan(id(m[1])); await run('DELETE FROM plans WHERE id = ? AND user_id = ?', id(m[1]), uid(`
- `server.js:407` `const user = await userFromReq(req);   // 사용자는 오직 세션 쿠키로만 결정한다`
- `server.js:411` `if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-requested-with'] !== 'diary') throw bad('잘못된 요청입니다.');`
- `server.js:414` `if (url.pathname !== '/api/health' && !user) throw new HttpError(401, '로그인이 필요합니다.');`

> PASS · T07-C126 · 거절을 만드는 소스 위치(WHERE ... user_id = ? 조건, uid(), 로그인 확인)가 위에 줄 번호와 함께 있다

## 12. 배포본 정리 / 서버 출력 검사

> PASS · T07-C105 · 로그인 요청·응답을 적은 이 기록에 비밀번호 원문이 남아 있지 않다

> PASS · T07-C106 · 서버 출력(로그)·모든 네트워크 응답 어디에도 비밀번호 원문이 없다

> PASS · T07-C46/C131 · 이 증거 파일에 비밀번호·세션 토큰 원문이 없다(마스킹 후 재검사)
