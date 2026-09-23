# 과제 4 · 서비스 화면 분리 검사

2026-09-23 KST. 자동 브라우저 검사이며 사용자의 직접 사용성 평가나 플랫폼 채점 결과가 아닙니다. 이전 배포 검사는 [9월 22일 기록](QA-2026-09-22.md)에 보존했습니다.

| 검사 | 결과 |
| --- | --- |
| 데이터·공식 fixture | 32/32 통과. 원천·KST·일별 갱신·공식 5종 실패·D2 복구 |
| 로컬 메인 | [12/12](verification/service-main-local.json). 실제 값·24시간·7일, 실패 5종, 마지막 정상 캐시 보존, 검증 기록 분리 |
| 로컬 검증 화면 | [27/27](verification/service-review-local.json). 공식 오류·복구 및 실제 저장 보존 |
| 로컬 원자료 대조 | [4/4](verification/service-evidence-local.json). 해시·날짜 오염 거절과 정상 복구 |
| 공개 메인·검증·원자료 | [12/12](verification/service-main-public.json) · [27/27](verification/service-review-public.json) · [4/4](verification/service-evidence-public.json) |
| 배포·공개 접근 | 메인·검증 화면 무인증 접근, [전체 커밋 소스 접근](verification/service-source-access.json), [배포 파일 13개 SHA-256 일치](verification/service-public-file-hashes.json) |
| 실제 두 날짜 | [원자료 해시·값 대조](verification/two-real-days.json), [로컬 화면](verification/service-two-day-screen.json), [공개 화면](verification/service-two-day-public-screen.json) 대조 |
| 비밀값 | [검색 보고서](verification/secret-scan.json). 원문 키 패턴 및 로컬 비공개 설정 값과 비교. 키는 출력하지 않음 |
| 플랫폼 봉인 영수증·제출 | 미확인 |

## 실제 두 날짜

| 구분 | KST 실제 수신 시각 | 원천 시각 | 값 |
| --- | --- | --- | --- |
| 첫 보관 | 2026-09-22 09:36:25.628 | 09:30 | 21.9°C |
| 둘째 보관 | 2026-09-23 13:45:35.713 | 13:45 | 25.8°C |

화면의 보관값 변화는 **25.8 − 21.9 = +3.9°C**입니다. 두 원문 SHA-256, 동일 원천 URL·값·시각·단위를 대조했습니다. 일별 최근값 표는 9월 22일 후속 수집 25.5°C를 사용하므로 **25.8 − 25.5 = +0.3°C**입니다. 화면에서 두 목적을 구분하며 어느 쪽도 하루 평균이나 같은 시각 비교로 설명하지 않습니다.

검증한 소스: https://github.com/PeterAhnn/SKT-ALEPH-Project-4-Dashboard/commit/9f6d858d244f962f7ab104a2c14f9a029b1f9a28

현재 공공데이터포털 API는 [조사·선정](PUBLIC-API-PLAN.md) 단계입니다. 사용자 키로 기상청 응답을 수신했다고 주장하지 않으며 서비스 화면의 Open-Meteo 출처를 유지합니다. 메인에는 합성 fixture나 플랫폼 영수증 관련 UI를 넣지 않고 하단 링크로 검증 화면에 접근합니다.
