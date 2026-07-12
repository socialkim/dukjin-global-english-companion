# Dukjin Global — AI Subtitle Companion

> **Built with Codex · Powered by ChatGPT 5.6sol**

한국어 YouTube 방송의 전사를 수집하고 원하는 언어로 자막을 번역한 뒤, 요약·키포인트·챕터·용어집을 생성하는 Chrome Manifest V3 확장 프로그램입니다. 특정 데모 영상에 종속되지 않습니다.

## v0.3.0에서 실제로 동작하는 기능

- 현재 YouTube 영상과 SPA 재생목록 이동 감지
- 열린 YouTube 스크립트 패널에서 전체 timed transcript 수집
- 한국어 자막을 켜고 시청한 구간의 live cue 수집
- 번역과 요약에 서로 다른 GPT 모델을 선택하는 비용 최적화
- 기본값: 자막 `gpt-5.4-mini`, 요약·챕터 `gpt-5.6-luna`
- 45개 cue 단위 순차 번역과 진행률·취소 처리
- 번역 자막을 플레이어 재생 시간에 동기화
- 영상별 결과 로컬 캐시와 검색 가능한 한영 전사
- 타임스탬프 클릭 seek
- Chrome 온디바이스 한국어→영어 실시간 번역 폴백
- API 오류, 자막 미발견, 영상 전환, 캐시 삭제 처리
- 현재 YouTube 영상 썸네일과 원본 바로가기
- Korean, English, Japanese, Chinese, Spanish, French, German, Portuguese 출력
- 선택 언어로 1080×1920 정확 조판 인포그래픽 PNG 생성
- GPT Image 2 기반 일러스트형 인포그래픽 선택 생성
- 근거 타임스탬프가 포함된 상세 보고서 생성
- 보고서 Markdown 및 인쇄용 HTML 다운로드

## 다운로드와 설치

1. GitHub Releases에서 `dukjin-global-extension-v0.3.0.zip`을 내려받아 압축을 풉니다.
2. Chrome 138 이상에서 `chrome://extensions`를 엽니다.
3. **개발자 모드**를 켭니다.
4. **압축해제된 확장 프로그램을 로드**하고 압축을 푼 폴더를 선택합니다.
5. 한국어 자막이 있는 YouTube 영상을 열고 확장 프로그램 아이콘을 누릅니다.

## 영상 분석 사용법

1. YouTube 영상 설명 또는 메뉴에서 **스크립트 표시(Show transcript)**를 엽니다.
2. 확장 프로그램에서 **Capture transcript**를 누릅니다.
3. Settings에서 보안 프록시 또는 개인 세션 키를 설정합니다.
4. **Translate + analyze**를 누릅니다.
5. 완료되면 번역 자막이 영상에 표시되고 Summary, Transcript, Glossary 탭이 채워집니다.

## 인포그래픽과 보고서 사용법

1. YouTube에서 전체 스크립트를 열고 **Capture transcript**를 누릅니다.
2. **Infographic & report studio**에서 출력 언어를 선택합니다.
3. **Create infographic** 또는 **Create report**를 누릅니다. 한 번의 구조화 분석으로 두 결과가 함께 준비됩니다.
4. 기본 인포그래픽은 정확한 텍스트를 유지하는 1080×1920 Canvas PNG입니다.
5. 시각적 일러스트가 필요하면 **AI illustrated version**을 눌러 GPT Image 2 포스터를 생성합니다.
6. 보고서는 Markdown 또는 인쇄용 HTML로 내려받을 수 있습니다. HTML을 브라우저에서 열고 인쇄하면 PDF로 저장할 수 있습니다.

GPT Image 모델은 글자 배치와 철자를 완벽하게 보장하지 않으므로, 정확한 문구가 중요한 배포물에는 기본 Canvas PNG를 사용하십시오.
계정 상태에 따라 GPT Image 사용 전에 OpenAI API 조직 확인이 필요할 수 있습니다.

YouTube가 스크립트를 제공하지 않으면 한국어 자막을 켜고 영상을 시청하십시오. 시청한 구간의 cue를 모아 부분 분석할 수 있습니다.

## API 연결 — 권장 방식

OpenAI는 API 키를 브라우저 같은 클라이언트 환경에 배포하지 말 것을 권장합니다. 따라서 기본 모드는 저장소에 포함된 작은 보안 프록시입니다.

```bash
cd proxy
copy .env.example .env
```

`.env` 값을 운영체제 환경변수로 설정합니다. `.env` 파일 자체를 읽는 라이브러리는 포함하지 않았습니다.

PowerShell 예시:

```powershell
$env:OPENAI_API_KEY="sk-your-project-key"
$env:PROXY_TOKEN="a-long-random-secret"
$env:PORT="8787"
npm run start:env
```

확장 프로그램 Settings:

- Connection mode: `Secure proxy`
- Proxy endpoint: `http://localhost:8787/v1/responses`
- Proxy token: 위에서 설정한 값
- Subtitle model: `gpt-5.4-mini`
- Summary model: `gpt-5.6-luna`

공개 서버에 배포할 때는 반드시 `PROXY_TOKEN`, HTTPS, 사용량 제한, 인증을 추가하고 필요하면 `ALLOWED_EXTENSION_ID`를 설정하십시오.

## 개인 세션 키 모드

서버를 실행하기 어려운 개인 테스트를 위해 direct mode도 제공합니다.

- 키는 `chrome.storage.session`에만 저장됩니다.
- Chrome을 종료하면 삭제됩니다.
- 저장소, sync storage, local storage에는 기록하지 않습니다.
- 전송 대상은 `https://api.openai.com/v1/responses`뿐입니다.

다만 브라우저의 키는 완전한 보안 경계가 아닙니다. 전용 프로젝트 키, 제한된 권한, 낮은 월간 예산을 사용하고 공개 배포에서는 프록시 모드를 사용하십시오.

## 모델 선택과 비용

기본 설정은 호출 횟수가 많은 자막 번역에 `gpt-5.4-mini`, 한 번만 수행하는 요약·챕터 생성에 `gpt-5.6-luna`를 사용합니다. 가장 저렴하게 쓰려면 둘 다 5.4 mini로, 품질을 우선하면 Terra 또는 Sol로 변경할 수 있습니다.

| 선택 모델 | 권장 용도 | 표준 입력 / 출력 가격* |
| --- | --- | --- |
| `gpt-5.4-mini` | 대량 자막, 최저 비용 | $0.75 / $4.50 |
| `gpt-5.6-luna` | 균형형 요약 | $1.00 / $6.00 |
| `gpt-5.4` | 강한 범용 작업 | $2.50 / $15.00 |
| `gpt-5.6-terra` | 고품질 번역·요약 | $2.50 / $15.00 |
| `gpt-5.5` | 프리미엄 | $5.00 / $30.00 |
| `gpt-5.6-sol` | 최고 품질, 최고 비용 | $5.00 / $30.00 |

\* 2026-07-12 공식 가격표의 short-context 기준 100만 토큰당 USD입니다. 최신 가격은 [OpenAI API Pricing](https://developers.openai.com/api/docs/pricing)을 확인하십시오.

## OpenAI 요청 구조

- Responses API
- Image API (`gpt-image-2`, 사용자가 일러스트형 모드를 선택한 경우만)
- 기본 자막 모델 `gpt-5.4-mini`, 기본 분석 모델 `gpt-5.6-luna`
- strict JSON Schema structured outputs
- 분석 요청 1회 + 자막 45개 단위 번역 요청
- 입력은 사용자가 명시적으로 분석 버튼을 누른 영상 전사만 포함
- 모델 출력은 HTML로 삽입하지 않고 `textContent`로 렌더링
- 전사 안의 문장을 명령으로 취급하지 않도록 prompt-injection 경계를 명시
- 보고서와 인포그래픽의 주장마다 원본 전사의 가까운 타임스탬프를 요구
- 이미지 생성 프록시는 GPT Image 2, 1장, PNG, 허용된 크기·품질만 통과

## 권한과 개인정보

- `storage`: 설정, 세션 credential, 영상별 분석 캐시
- `sidePanel`: YouTube 옆 companion UI
- `api.openai.com`: 개인 세션 키 모드
- 선택적 host permission: 사용자가 지정한 프록시 주소에만 승인 후 접근
- YouTube content script: 현재 영상 ID, 시간, 표시된 자막, 사용자가 연 스크립트 패널

쿠키, Google 계정, 시청 기록, 광고 데이터는 읽지 않습니다.

## 개발과 검증

```bash
npm test
npm run check
```

GitHub Actions가 push와 pull request마다 단위 테스트, JavaScript 문법, manifest JSON을 검사하고 설치용 ZIP을 생성합니다.

## 운영상 제한

- YouTube transcript DOM은 공식 API가 아니므로 YouTube UI 변경 시 selector adapter 업데이트가 필요할 수 있습니다.
- 채널 운영자가 전체 자막을 안정적으로 제공하려면 YouTube Studio 내보내기 또는 소유자 OAuth 기반 백엔드 카탈로그가 가장 좋습니다.
- 자동 자막에는 인명·제품명·숫자 오류가 있을 수 있으므로 중요한 내용은 원본 영상과 대조해야 합니다.

## 라이선스

코드는 MIT License입니다. 영상·자막·방송 콘텐츠의 권리는 각 원저작자에게 있습니다.
