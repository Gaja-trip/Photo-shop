# Google Drive 자동 저장 연결

대상 폴더: `Photo-Mix`

1. 폴더 소유자(`rokafap2@gmail.com`)로
   [Google Apps Script](https://script.google.com/) 프로젝트를 만듭니다.
2. `Code.gs`의 내용을 붙여넣습니다.
3. 프로젝트 설정의 스크립트 속성에 아래 값을 추가합니다.
   - `TARGET_FOLDER_ID`: `1T9pwEsFZaNMPB8GldEg6NGPXoggxUdnG`
   - `UPLOAD_HMAC_SECRET`: 32자 이상의 임의 문자열
4. 웹 앱으로 배포합니다.
   - 실행 사용자: 나
   - 액세스 권한: 모든 사용자
5. Sites 런타임 환경 변수에 아래 값을 설정한 뒤 새 버전을 배포합니다.
   - `APPS_SCRIPT_UPLOAD_URL`: 배포된 `/exec` URL
   - `APPS_SCRIPT_UPLOAD_HMAC_SECRET`: 위와 동일한 값
   - `UPLOAD_ALLOWED_ORIGINS`: 허용할 사이트 주소

`UPLOAD_HMAC_SECRET`은 저장소나 브라우저 코드에 넣지 않습니다.
