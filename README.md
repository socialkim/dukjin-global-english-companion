# Dukjin Global — AI Video Studio

> **Built with Codex · Powered by ChatGPT 5.6 Sol**

한국어 YouTube 방송을 다국어 자막, 한 장 인포그래픽, 보고서로 전환하는 Chrome Manifest V3 확장 프로그램입니다. v0.4.0부터 작업을 시작하기 전에 **온디바이스 모드**와 **OpenAI API 모드**를 명확히 선택합니다.

## 두 가지 모드

| 기능 | 온디바이스 모드 | OpenAI API 모드 |
| --- | --- | --- |
| API 키 | 필요 없음 | 프록시 또는 개인 세션 키 필요 |
| 실시간 자막 | Chrome Translator 지원 언어 | 분석 후 생성된 전체 자막 |
| 전체 자막 번역 | 기기 내 Translator | 선택한 GPT 모델 |
| 요약 | 시간대별 대표 장면을 고르는 추출형 빠른 요약 | 맥락을 종합하는 생성형 요약 |
| 보고서 | 로컬 빠른 브리프 | 근거 타임스탬프가 포함된 상세 편집 보고서 |
| 인포그래픽 PNG | 정확한 Canvas 조판 | 정확한 Canvas 조판 |
| AI 일러스트 이미지 | 지원하지 않음 | GPT Image 2 선택 사용 |
| 데이터 처리 | Chrome 안에서 처리 | 실행 버튼을 누를 때 캡처 자막을 API로 전송 |

온디바이스 모드에서도 보고서와 인포그래픽은 생성됩니다. 다만 보고서는 생성형 모델의 종합 분석이 아니라 자막의 시간대별 대표 장면을 재구성한 **추출형 빠른 브리프**이고, 인포그래픽은 외부 이미지 모델이 그린 그림이 아니라 정확한 글자 조판을 우선한 **Canvas PNG**입니다.

## 설치

1. GitHub Releases에서 최신 `dukjin-global-extension-v0.4.0.zip`을 내려받아 압축을 풉니다.
2. Chrome에서 `chrome://extensions`를 엽니다.
3. **개발자 모드**를 켭니다.
4. **압축해제된 확장 프로그램을 로드합니다**를 누르고 압축을 푼 폴더를 선택합니다.
5. 한국어 자막이 있는 YouTube 영상을 열고 확장 프로그램 아이콘을 누릅니다.

## 공통 작업 순서

1. 사이드패널 상단에서 **On-device** 또는 **OpenAI API**를 선택합니다.
2. YouTube 영상 설명/메뉴에서 **스크립트 표시(Show transcript)**를 엽니다.
3. 확장 프로그램에서 **Capture transcript**를 누릅니다.
4. 출력 언어를 선택합니다.
5. 선택한 모드에 맞는 두 번째 버튼을 누릅니다.
6. Summary, Transcript, Studio에서 결과를 확인하고 영상 타임스탬프로 이동합니다.

## 온디바이스 모드

1. 상단에서 **On-device**를 선택합니다. 기본 모드이므로 API 키가 필요 없습니다.
2. 출력 언어가 한국어가 아니면 **Prepare**를 눌러 Chrome의 로컬 언어 팩을 준비합니다.
3. 전체 스크립트를 캡처한 뒤 **Run on device**를 누릅니다.
4. 번역 자막, 추출형 요약, 로컬 보고서, 정확한 Canvas 인포그래픽이 생성됩니다.

Chrome Translator API와 선택한 언어 쌍이 해당 기기에서 지원되어야 합니다. 지원되지 않으면 확장 프로그램이 이유를 표시하며, 이 경우 Korean 출력 또는 API 모드를 사용할 수 있습니다.

## OpenAI API 모드

1. 상단에서 **OpenAI API**를 누르면 Settings가 바로 열립니다.
2. 연결 방식을 선택합니다.
   - **Secure proxy**: 권장. API 키를 Chrome 밖의 서버 환경변수에 보관합니다.
   - **Personal session key**: 개인 테스트용 고급 옵션. 키는 `chrome.storage.session`에만 저장하고 Chrome 종료 시 삭제합니다.
3. **Save session**과 **Test connection**으로 연결을 확인합니다.
4. 스크립트를 캡처한 뒤 **Translate + analyze**를 누릅니다.
5. Studio에서 상세 보고서, 정확한 Canvas PNG, 선택적 GPT Image 2 일러스트를 만듭니다.

OpenAI는 브라우저 같은 클라이언트 환경에 API 키를 배포하지 말고 자체 백엔드를 통해 요청할 것을 권장합니다. 공개 배포에는 반드시 프록시 방식을 사용하세요: [OpenAI API 키 안전 수칙](https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety)

### 권장 모델 기본값

- 자막 번역: `gpt-5.4-mini`
- 요약·보고서·인포그래픽 기획: `gpt-5.6-luna`
- 일러스트 이미지: `gpt-image-2`

모델 가격과 제공 여부는 바뀔 수 있으므로 배포 전 [OpenAI 모델 목록](https://developers.openai.com/api/docs/models)과 가격 페이지를 확인하세요.

## 보안 프록시 실행

```powershell
cd proxy
$env:OPENAI_API_KEY="sk-your-project-key"
$env:PROXY_TOKEN="a-long-random-secret"
$env:PORT="8787"
npm run start:env
```

확장 프로그램 Settings:

- Connection method: `Secure proxy`
- Proxy endpoint: `http://localhost:8787/v1/responses`
- Proxy token: 위에서 설정한 값

공개 서버에서는 HTTPS, 사용자 인증, 요청량 제한, 지출 제한과 `ALLOWED_EXTENSION_ID`를 추가하세요.

## 자막 토글과 Settings 문제 해결

- Settings는 상단 **Open API settings** 버튼 또는 고정된 4칸 탭의 **Settings**에서 열 수 있습니다.
- Player subtitles 스위치는 상태를 로컬에 기억하고 현재 YouTube 콘텐츠 스크립트에 전달합니다.
- “content script did not respond”가 표시되면 YouTube 탭을 한 번 새로고침한 뒤 다시 켭니다. 확장 프로그램을 업데이트한 직후 열려 있던 탭에는 새 콘텐츠 스크립트가 아직 주입되지 않았을 수 있습니다.
- 자막이 켜져 있어도 번역 cue가 없으면 오버레이는 표시되지 않습니다. 먼저 온디바이스 번역 또는 API 분석을 완료하세요.
- YouTube 자동 자막만 사용하는 경우 한국어 자막을 화면에 켜야 실시간 cue가 수집됩니다.

## 권한과 개인정보

- `storage`: 모드, 설정, 자막 상태, 영상별 결과 캐시
- `sidePanel`: YouTube 옆의 작업 UI
- `api.openai.com`: 개인 세션 키 모드
- 선택적 host permission: 사용자가 지정한 프록시 주소
- YouTube content script: 현재 영상 ID, 재생 시간, 표시 중인 자막, 사용자가 연 스크립트 패널

쿠키, Google 계정 정보, 전체 시청 기록, 광고 데이터는 읽지 않습니다.

## 개발 및 검증

```bash
npm run check
npm test
```

테스트는 모드 마이그레이션, 모델 라우팅, 구조화 출력, 온디바이스 빠른 브리프, 보고서 escaping, 타임스탬프, 인포그래픽·Settings 컨트롤을 확인합니다.

## 한계

- YouTube transcript DOM은 공식 API가 아니므로 YouTube UI가 바뀌면 selector 업데이트가 필요할 수 있습니다.
- 온디바이스 결과는 추출형이므로 긴 문맥의 종합과 논지 추론은 API 모드보다 제한적입니다.
- 자동 자막에는 인명·제품명·숫자 오류가 있을 수 있으므로 중요한 내용은 원본 영상과 대조해야 합니다.
- GPT Image 계열은 정확한 문구 조판을 보장하지 않습니다. 배포용 글자가 중요하면 Canvas PNG를 사용하세요.

## 라이선스

코드는 MIT License입니다. 영상·자막·방송 콘텐츠의 권리는 각 원저작자에게 있습니다.
