# Dukjin Global — English Companion

> **Built with Codex · Powered by ChatGPT 5.6sol**

김덕진의 한국어 AI 방송을 해외 시청자가 볼 수 있도록 영어 자막, 영어 요약, 챕터, 검색 가능한 전사를 제공하는 Chrome Manifest V3 확장 프로그램입니다.

## 다운로드

가장 쉬운 방법은 GitHub의 **Releases**에서 최신 ZIP을 받는 것입니다. 저장소의 `dist/dukjin-global-extension-v0.1.0.zip`도 같은 설치 패키지입니다.

## 설치

1. ZIP을 압축 해제합니다.
2. Chrome 138 이상에서 `chrome://extensions`를 엽니다.
3. **개발자 모드**를 켭니다.
4. **압축해제된 확장 프로그램을 로드**하고 압축을 푼 폴더를 선택합니다.
5. [GPT-5 데모 영상](https://www.youtube.com/watch?v=YTfathQEoXc)을 연 뒤 확장 프로그램 아이콘을 누릅니다.

## 동작하는 기능

- YouTube 재생 시간에 맞춘 영어 자막 오버레이
- 영어 TL;DR, 핵심 포인트, 챕터
- 검색 가능한 한영 전사
- 타임스탬프 클릭으로 영상 이동
- 자막 출처와 AI 생성 상태 표시
- Chrome 온디바이스 한국어→영어 실시간 번역
- 네트워크나 API 키 없이 동작하는 번들 데모

다른 영상에서는 YouTube의 한국어 자막을 켠 뒤 side panel에서 **Start live on-device translation**을 선택합니다. 번역 모델은 사용자 동의 후 Chrome이 로컬로 내려받으며, 자막 텍스트를 외부 서버에 전송하지 않습니다.

## 권한과 개인정보

- `storage`: 현재 영상 상태를 로컬에 보관
- `sidePanel`: YouTube 옆 companion UI
- YouTube content script: 영상 ID, 재생 시간, 화면에 표시된 자막 cue 감지
- 쿠키, Google 계정, 시청 기록, 광고 데이터는 읽지 않습니다.
- `tabs`, `identity`, `webRequest`, `<all_urls>` 권한을 사용하지 않습니다.

## 제작자 검수 카탈로그로 전환

번들 데모를 전체 방송으로 확장할 때는 `background.js`의 `DEMO_CATALOG` 대신 읽기 전용 localization API를 연결합니다. 채널 소유자가 YouTube OAuth로 자막을 내보내고 영어 번역·요약·검수를 선처리하는 방식을 권장합니다.

## 라이선스

코드는 MIT License입니다. 영상·자막·방송 콘텐츠의 권리는 각 원저작자에게 있습니다.
