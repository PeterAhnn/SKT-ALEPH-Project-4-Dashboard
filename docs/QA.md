# 과제 4 · 대구 변경 검사 기록

2026-09-22 KST, 사용자가 선택한 대구 날씨·예보 및 공식 5단계 기준을 적용한 변경의 검사 기록입니다. 자동 검사·실제 날짜 관찰·공개 배포·플랫폼 영수증은 서로 구분합니다. 브라우저 검사는 자동 실행이며 사용자의 직접 확인이나 사람의 사용성 평가로 기록하지 않습니다.

## 확인 결과

| 검사 | 결과와 근거 |
| --- | --- |
| 공식 자산 파일 hash | manifest 대상 17개 파일 SHA-256 일치. [asset-checks.json](verification/asset-checks.json) |
| 공식 fixture canonical hash | fixture 9개 모두 일치. 동일 검사 JSON |
| 공식 계약 | package `aleph-t04-real-information-board-public-contract-v2`, contract 2.0.0, fixture 1.1.0, 정본 35개 조건 |
| 통합 자동 검사 | `npm test` **32/32 통과**: [실제 데이터 처리 16건](../tests/core.test.mjs), [공식 합성 adapter 16건](../tests/fixture-adapter.test.mjs) |
| 로컬 브라우저 | **27/27 통과**. 2026-09-22 09:43:59.533 KST, [결과 JSON](verification/daegu-local-browser.json) |
| 공개 배포 브라우저 | **27/27 통과**. 2026-09-22 09:48:13.106 KST, [결과 JSON](verification/daegu-public-browser.json) |
| 원자료 검증·오염 거절 | 로컬 **4/4**, 공개 **4/4** 통과. 실제 hash/값 대조, 합성 원문 hash 불일치 거절, 날짜 불일치 거절, 실제 원자료 복구·저장 보존. [로컬](verification/daegu-local-evidence.json) · [공개](verification/daegu-public-evidence.json) |
| 화면 크기 | 1440px·390px에서 가로 넘침 없음. [데스크톱](verification/daegu-public-desktop.png) · [모바일](verification/daegu-public-mobile.png) |
| 공개 접근 | 결과물 HTTP 200, 새 격리 브라우저에서 인증 요구 없이 열림. [결과물 접근 근거](verification/daegu-public-access.json) |
| 정상 화면 콘솔 | 공개 정상 조회 후 콘솔 오류 없음. 합성 오류 주입 검사와 구분 |
| 공개 소스 접근 | GitHub HTTP 200, 전체 커밋과 Browse files 표시, 로그인하지 않은 상태의 Sign in 링크, 비밀번호 입력 0개. [접근 근거](verification/daegu-public-source-access.json) |
| 배포·소스 일치 | 앱·공개 데이터 9개 파일 SHA-256이 전체 커밋 `28481cff72fdbfc90a3f3f1e3463bcac497b01a0`과 모두 일치. [해시 대조](verification/daegu-public-file-hashes.json) |
| 비밀값 검색 | 작업 파일 48개·Git 이력 blob 87개에서 검사한 비밀값/패턴 0건. 민감 설정 추적 파일·원천 URL 비밀 query 0건. [검색 결과](verification/secret-scan.json) |
| 실제 네트워크 | 공개 기상 API 호출에 비밀키 없음. 응답과 공개 파일은 비개인 날씨 자료. [네트워크 기록](verification/daegu-public-network.txt) |
| 개인정보 | 공개 날씨 화면과 제출 문안에서 실제 개인정보·개인 기록 발견 없음. 개인 위치를 수집하지 않음 |
| 독립 코드 검토 | 최종 변경의 독립 검토에서 미해결 지적 없음 |
| 실제 날짜 | 대구 공개 일별 기록 1일·심사용 보관 1일. 둘째 실제 날짜와 변화 대조 미완료 |
| 플랫폼 영수증 | 사용자가 날짜 기록 화면을 아직 확인하지 않았다고 답함. `t04_day` 정확히 2건 존재·날짜·봉인 payload 미확인 |

검증한 [앱·공개 데이터 전체 커밋](https://github.com/PeterAhnn/SKT-ALEPH-Project-4-Dashboard/commit/28481cff72fdbfc90a3f3f1e3463bcac497b01a0)은 뒤이은 검사 자료·문서 정리 커밋과 구분합니다. 9개 파일 대조 대상은 `index.html`, `app.mjs`, `core.mjs`, `weather-view.mjs`, `fixture-adapter.mjs`, `style.css`, `data/observations.json`, `data/review-evidence.json`, `data/weather.json`입니다.

원본 서울 시제품의 검사 결과는 [서울 보관 문서](archive/seoul-prototype/QA.md)에 있습니다. 이번 대구 검사 결과에 합산하지 않습니다. 소스·배포·네트워크 검사는 실행한 범위의 확인이며 과제 제출·승인을 대신하지 않습니다.

## 실제 대구 수집과 보존

| 기록 | 실제 수신 시각 · KST | 원천 기준 시각 · KST | 기온 | 보존 결과 |
| --- | --- | --- | --- | --- |
| 첫 수집 | 2026-09-22 09:36:25.628 | 2026-09-22 09:30 | 21.9°C | 심사용 첫 보관값으로 고정 |
| GitHub Actions 후속 수집 | 2026-09-22 09:45:47.982 | 2026-09-22 09:45 | 22.3°C | 같은 날짜의 공개 일별 한 행·lastGood 갱신 |

첫 [원문 응답](../public/data/evidence/2026-09-22T00-36-25.628Z.json)의 SHA-256은 `039709bb02d857463203c022cba81903394c325f9963137cbdb00440c161fa2e`입니다. [후속 원문](../public/data/evidence/2026-09-22T00-45-47.982Z.json), [최근 정상 일별 저장](../public/data/observations.json), [심사용 고정 보관](../public/data/review-evidence.json)도 보존합니다. 원천은 Open-Meteo·대구 `35.8714, 128.6014`이며 현재 값은 기상 모델 기반입니다.

같은 날 다시 수집했으므로 **실제 날짜는 1일/2일**입니다. 일별 최근값 22.3°C와 심사용 첫 보관값 21.9°C는 목적이 다른 저장 자료입니다. 각 화면은 대응하는 자료끼리 대조합니다. 서울 시제품의 19.5°C·20°C는 대구 기록에 포함하지 않습니다.

첫 실제 응답에는 시간별 168개·일별 7개 예보가 있었고 화면에는 앞으로 24시간·7일을 표시합니다. 예보 날짜는 실제 두 날짜 관찰에 넣지 않습니다.

## 공식 재생·복구 검증 범위

- 초기화→D1-A(100)→D1-B(105)→같은 날 재실행: record ID·한 행 유지, 값은 최신 성공으로 갱신합니다.
- 지연·외부 원천 거절·호출 제한·오프라인·형식 변경: 다섯 오류 코드·설명·다음 행동을 구분하고 105·기존 한 행·stale을 유지합니다.
- 각 실패 후 RECOVER-D2: `fresh/none`, 120, 총 두 행·다음 날짜 신규 한 행으로 복구합니다. 복구를 반복해도 행이 중복되지 않습니다.
- D1→D2: 저장한 105와 120의 변화 절대값은 15입니다.
- 합성 초기화·재생은 실제 대구 기록을 변경하지 않습니다.

로컬·공개 각각 27개 브라우저 검사에는 실제 원천·24시간/7일 예보·원자료/저장값/화면값 대조, 공식 오류별 반복 복구, 실제 조회 경로에 합성 오류를 주입한 정상값 보존, 실제 원천 복구, 내보내기·테마·화면 가로폭 확인이 포함됩니다. 추가 원자료 검사 각각 4개는 별도 집계입니다. 합성 오류는 실제 원천 장애 발생 기록이 아닙니다.

## 자동 수집과 다음 실제 날짜

GitHub Actions [실행 35673266121](https://github.com/PeterAhnn/SKT-ALEPH-Project-4-Dashboard/actions/runs/35673266121)에서 32개 검사·실제 대구 수집·저장소 반영이 성공했습니다. [보관한 실행 결과](verification/daegu-collection-workflow.json)에서 각 단계 성공을 확인할 수 있습니다. [예약 설정](../.github/workflows/daily.yml)은 매일 09:20 KST입니다. 작업은 지연될 수 있으며 실제 수신 시각으로 KST 날짜를 정합니다. 이번 성공은 다음 날 예약 실행 성공을 미리 증명하지 않습니다.

남은 확인은 다음과 같습니다.

- [ ] 다른 실제 KST 날짜의 대구 수집·공개 반영·두 보관값의 변화 재계산
- [ ] 플랫폼 `t04_day` 봉인 영수증 정확히 2건의 KST 날짜·payload와 보관값·화면값 대조
- [ ] 결과물/소스 URL·확인법·판단의 실제 플랫폼 제출 여부 확인

별도 인증 파일이나 증거 ZIP 수작업은 필요하지 않습니다. 로컬 보관 자료를 플랫폼 봉인 영수증으로 설명하지 않으며 제출·승인·후행 채점 상태를 이 검사만으로 완료 처리하지 않습니다.
