# jarvis-browser v1.0.0 릴리즈 노트

**일자**: 2026-02-19
**코드량**: ~8,655 LOC (TypeScript 소스 40개 파일)
**테스트**: 306개 (18개 테스트 파일, 커버리지 84.89%)
**의존성**: playwright-core ^1.58.0, vitest ^3.0.0

## 업그레이드 요약 (v0.6.0 -> v1.0.0)

**장애 모드 제거 로드맵**을 구현한 4단계 업그레이드:
모든 기능은 자율 에이전트가 실제 브라우저 자동화 중 **실패했기 때문에** 존재합니다.

| Phase | 버전 | 테마 | 신규 파일 | 주요 추가 기능 |
|-------|------|------|----------|---------------|
| 5 | v0.7.0 | 자율 복원력 | 소스 4 + 테스트 6 | 다이얼로그, 업로드, 상태쿼리, Get, --json |
| 6 | v0.8.0 | 지능형 인지 | 소스 1 | 시맨틱 로케이터, Observer 본문 캡처 |
| 7 | v0.9.0 | 강화된 운영 | 소스 4 | 암호화, HAR 내보내기, 통계, 하이라이트 |
| 8 | v1.0.0 | 플랫폼 | 소스 3 | 에뮬레이션, PDF, 녹화, 프록시 |

**총 명령어: ~105개** (v0.6.0의 62개 + 신규 ~43개)
**복구 체인: 7개 오류 유형** (v0.6.0의 3개 + 신규 4개)

---

## Phase 5: 자율 복원력 (v0.7.0)

에이전트 세션이 죽거나 사람 개입이 필요했던 5가지 장애 모드를 제거합니다.

### FM-1: 다이얼로그 차단 -> 자동 처리
```bash
jarvis-browser dialog list                          # 다이얼로그 히스토리 조회
jarvis-browser dialog last                          # 최근 다이얼로그
jarvis-browser dialog accept                        # 현재 다이얼로그 수락
jarvis-browser dialog dismiss                       # 현재 다이얼로그 닫기
jarvis-browser config set dialog-mode queue         # accept | dismiss | queue
```

다이얼로그가 더 이상 페이지를 차단하지 않습니다. `dialog-mode` 설정에 따라 자동 처리되고, 리뷰를 위해 로그에 기록됩니다.

### FM-2: 파일 업로드 -> CLI 한 줄
```bash
jarvis-browser upload e5 /path/to/file.pdf          # input ref로 업로드
jarvis-browser upload --near e3 /path/to/image.png  # 숨겨진 input 자동 감지
```

3단계 숨겨진 input 탐색: tagName 확인 -> input type 스캔 -> 부모 DOM 탐색.

### FM-3: 맹목적 액션 -> 사전 확인
```bash
jarvis-browser is visible e5                        # 요소 가시성 확인
jarvis-browser is enabled e3                        # 상호작용 가능 여부
jarvis-browser is checked e7                        # 체크박스 상태
jarvis-browser is editable e2                       # 입력 편집 가능 여부

jarvis-browser wait --visible e5                    # 가시성 대기
jarvis-browser wait --enabled e3                    # 상호작용 가능 대기
```

### FM-4: 파싱 불가 출력 -> 모든 곳에 --json
```bash
jarvis-browser snapshot --json                      # 구조화된 JSON 봉투
jarvis-browser click e5 --json                      # {"ok":true,"data":{...}}
jarvis-browser get text e3 --json                   # 타입 안전 추출
```

모든 명령어가 shared.ts의 `formatOutput()`을 통해 `--json`을 지원합니다.

### FM-5: 다운로드 -> 대기 + 저장
```bash
jarvis-browser wait --download --save-to /tmp/      # 다운로드 이벤트 대기
```

### Get 명령어 (구조화된 데이터 추출)
```bash
jarvis-browser get text e5                          # 요소 텍스트
jarvis-browser get html e5                          # 내부 HTML
jarvis-browser get value e3                         # 입력값
jarvis-browser get attr e5 href                     # 속성값
jarvis-browser get title                            # 페이지 제목
jarvis-browser get url                              # 현재 URL
jarvis-browser get count "button"                   # 셀렉터 요소 개수
jarvis-browser get box e5                           # 바운딩 박스
```

### 복구 체인 확장
| 오류 유형 | 복구 방법 | 추가 버전 |
|----------|----------|----------|
| stale_ref | 재스냅샷 + ref 재매칭 | v0.6.0 |
| not_interactable | 스크롤 + Escape + 재시도 | v0.6.0 |
| strict_mode | 중복 해소 재스냅샷 | v0.6.0 |
| **dialog_blocking** | **자동 닫기 + 재시도** | **v0.7.0** |
| **navigation_changed** | **새 페이지에서 재스냅샷** | **v0.7.0** |

---

## Phase 6: 지능형 인지 (v0.8.0)

스냅샷 비용을 줄이고 시맨틱 요소 타겟팅을 추가합니다.

### FM-6: 비싼 스냅샷 -> 시맨틱 로케이터
```bash
jarvis-browser find role button "Submit"            # ARIA 역할 + 이름으로
jarvis-browser find text "Welcome"                  # 보이는 텍스트로
jarvis-browser find label "Email"                   # 연관 라벨로
jarvis-browser find placeholder "Enter email"       # placeholder로
jarvis-browser find testid "login-btn"              # data-testid로

# 찾기 + 액션 한 번에
jarvis-browser find role button "Submit" --action click
jarvis-browser find label "Email" --action fill --value "user@test.com"
```

스냅샷 불필요. Playwright 시맨틱 로케이터 직접 사용.

### FM-7: 오버레이 간섭 -> 자동 닫기
연속된 `not_interactable` 오류 발생 시 오버레이 감지 및 자동 닫기:
- 쿠키 동의 배너
- 뉴스레터 팝업
- 모달 오버레이
- 채팅 위젯

### Observer 강화
```bash
jarvis-browser requests --method POST               # HTTP 메서드 필터
jarvis-browser requests --status 4xx                 # 상태 코드 범위 필터
jarvis-browser requests --with-body                  # 응답 본문 포함
jarvis-browser config set network-body-max-kb 64     # 본문 크기 제한
```

### 향상된 Page Info
```bash
jarvis-browser page-info                             # 추가 포함:
# viewport, devicePixelRatio, readyState, 다이얼로그 수
```

### 쿠키 필터
```bash
jarvis-browser cookies --domain "example.com"        # 대소문자 무시 도메인 필터
jarvis-browser cookies --name "session_id"           # 정확한 이름 매칭
```

---

## Phase 7: 강화된 운영 (v0.9.0)

보안, 관찰 가능성, 운영 견고성.

### FM-8: 세션 데이터 유실 -> 암호화된 세션
```bash
export JARVIS_BROWSER_ENCRYPTION_KEY="my-secret-key"
jarvis-browser session save "naver-login"            # .enc 파일로 암호화 저장
jarvis-browser session load "naver-login"            # 자동 복호화
```

AES-256-GCM + PBKDF2 (100,000회 반복). 하위 호환: `.enc` 없으면 비암호화 `.json` 로드.

### HAR 내보내기
```bash
jarvis-browser observe --export ./trace.har          # HAR 1.2 형식
jarvis-browser observe --export ./trace.json --format json  # Raw JSON
```

### 재시도 통계
```bash
jarvis-browser daemon health --json                  # retry_stats 포함:
# { total, recovered, failed, by_type, recovery_rate }
```

### 요소 하이라이트
```bash
jarvis-browser highlight e5                          # 빨간 외곽선 (기본)
jarvis-browser highlight e5 --color blue --duration 5
```

`locator.evaluate()`를 통한 CSS 외곽선 주입. 7가지 색상 지원.

### CAPTCHA 감지
CAPTCHA 패턴 감지 시 -> 즉시 실패 (재시도 안함) + 제안 메시지:
```json
{"ok":false,"error":"captcha_detected","suggestion":"수동 개입 필요"}
```

---

## Phase 8: 플랫폼 (v1.0.0)

포괄적 브라우저 자동화를 위한 시장 동등 기능.

### 디바이스 에뮬레이션
```bash
jarvis-browser set device "iPhone 14"               # 8개 프리셋 디바이스
jarvis-browser set viewport 1920 1080               # 커스텀 뷰포트
jarvis-browser set viewport 1920 1080 --dpr 2       # 디바이스 픽셀 비율 포함
jarvis-browser set geo 37.5665 126.9780             # 위치정보 (서울)
jarvis-browser set headers "X-Custom: value"        # 커스텀 HTTP 헤더
```

### PDF 생성
```bash
jarvis-browser pdf /tmp/page.pdf                    # PDF로 저장
jarvis-browser pdf /tmp/page.pdf --landscape        # 가로 방향
```

헤드리스 모드 필수. 경로는 `/tmp/`로 제한.

### 비디오 녹화
```bash
jarvis-browser record start /tmp/session.webm       # 녹화 시작
jarvis-browser record start --fps 10 --quality 80   # 커스텀 설정
jarvis-browser record status                        # 녹화 중인지 확인
jarvis-browser record stop                          # 중지 + 저장
```

CDP screencast 기반. FPS, 품질, 최대 프레임 수 설정 가능.

### 프록시 지원
```bash
jarvis-browser config set proxy "http://proxy:8080"
jarvis-browser config set proxy-bypass "localhost,*.internal"
```

---

## 설정 키 (v1.0.0)

| 키 | 기본값 | 설명 |
|----|-------|------|
| auto-retry | false | stale/blocked 요소 자동 재시도 |
| retry-count | 2 | 최대 재시도 횟수 |
| retry-delay-ms | 500 | 재시도 간 지연 |
| default-timeout-ms | 10000 | 기본 작업 타임아웃 |
| screenshot-dir | /tmp | 스크린샷 출력 디렉토리 |
| console-buffer-size | 500 | 콘솔 링 버퍼 용량 |
| network-buffer-size | 200 | 네트워크 링 버퍼 용량 |
| daemon-idle-timeout-m | 30 | 데몬 자동 종료 (분) |
| dialog-mode | accept | 다이얼로그 처리: accept/dismiss/queue |
| network-body-max-kb | 0 | 네트워크 응답 본문 캡처 (0=끔) |
| proxy | "" | HTTP 프록시 URL |
| proxy-bypass | "" | 프록시 우회 패턴 |

## 검증 결과

| 항목 | 결과 |
|------|------|
| TypeScript strict | 0 errors |
| 테스트 | 306/306 통과 (18개 파일) |
| 커버리지 | 84.89% (임계값 80%) |
| 하위 호환 | v0.6.0 모든 명령어 보존 |
| 복구 체인 | 7/7 오류 유형 검증 |
| Sisyphus Codex | 4/4 phases PASS |

## 버전 히스토리

| 버전 | 일자 | 테마 | 커밋 |
|------|------|------|------|
| v0.2.0 | 2026-02-18 | 코어 CLI | f630389 |
| v0.6.0 | 2026-02-19 | 데몬 + Observer + 컨트롤러 + 복원력 | 4dcdf93 |
| v1.0.0 | 2026-02-19 | 장애 모드 제거 (8/8) | 06cc564 |
