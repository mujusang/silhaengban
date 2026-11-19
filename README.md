# 자체 실행반 (silhaengban)

구글 시트 `26년 11월 자체 실행반`과 연동되는 GitHub Pages 웹앱입니다.
휴대폰에서 손가락으로 주차 체크를 톡톡 누르면 시트에 바로 기록됩니다.

- 앱: https://mujusang.github.io/silhaengban/
- 설치 가이드: https://mujusang.github.io/silhaengban/guide.html
- 백엔드 코드: [`apps-script/Code.gs`](apps-script/Code.gs)

## 모드

| 모드 | 설명 |
|---|---|
| 시연(기본) | 시트 없이도 모든 기능이 동작합니다. 2026-11-19 기준 `26년 11월` 탭 스냅샷을 씨앗으로, 변경은 기기(localStorage)에만 저장됩니다. |
| 시트 연결 | ⚙ 설정에 Apps Script 웹앱 URL을 넣으면 시트를 읽고 씁니다. |

## 기능

- 월 선택(시트 탭 `26년 11월` 형식 자동 인식)
- 전체 달성률 링(총 체크 ÷ 총 목표), 참여 인원, 연장 인원, 이번 주차 표시
- 개인별 진도 막대 그래프 — 누르면 해당 참가자 카드로 이동
- 참가자 카드: 주차 체크 토글, 달성률, 목표 수정(목표 문구·총 목표 횟수), 다음 달도 참여(연장여부)
- 참여자 추가 — 시트에 행 추가 + 달성률 수식·체크박스 자동 부착
- 다음 달 이월 미리보기 → `26년 12월` 탭 자동 생성 + 연장 참여자 이월
- 내 이름 설정 시 내 카드가 맨 위 고정·강조

## 시트 구조 (자동 인식)

```
1행:  ..  E1 기간 (11/1 ~ 11/29)        J1 12월(다음 달 링크)
2행:  이름 | 달성 가능한 목표로 각자 설정 | 11월 총 목표 | 달성률 | 1주 | 2주 | 3주 | 4주 | 5주 | 연장여부
3행~: 참가자
```

열 위치는 **헤더 이름**(이름 / 목표 / 총 목표 / N주 / 달성률 / 연장여부)으로 찾기 때문에
달마다 주차 수(4주·5주)나 열 구성이 달라도 그대로 동작합니다.

## API (Apps Script)

배포 후 `…/exec` 로 호출합니다. 브라우저 앱은 CORS 없이 동작하도록 JSONP(`callback=`)를 씁니다.
서버·터미널에서는 같은 action을 POST(JSON) 또는 GET으로 호출할 수 있습니다.

| action | 파라미터 | 하는 일 |
|---|---|---|
| `ping` | – | 연결 확인, 시트 이름·탭 목록 |
| `get` | `month` | 그 달 전체 데이터(이름·목표·총목표·달성률·주차 체크·연장) |
| `toggleCheck` | `month`,`name`,`week`(1~N) | 해당 주차 체크 토글 |
| `setRenew` | `month`,`name`,`value`(true/false) | 연장여부 설정 |
| `updateGoal` | `month`,`name`,`goal`,`total` | 목표 문구·총 목표 수정 |
| `addMember` | `month`,`name`,`goal`,`total` | 새 행 추가(수식·체크박스 포함) |
| `rolloverPreview` | `month` | 다음 달 이름·기간·주차 수·이월 대상 명단 |
| `rollover` | `month`,`confirm=yes` | 다음 달 탭 생성(없으면) + 연장 참여자 이월 |

응답: `{ "ok": true, "data": { … } }` 또는 `{ "ok": false, "error": "…" }`

```bash
curl -s 'https://script.google.com/macros/s/XXXX/exec?action=ping'
curl -s 'https://script.google.com/macros/s/XXXX/exec?action=get&month=26년%2011월'
curl -s -X POST 'https://script.google.com/macros/s/XXXX/exec' \
  -H 'Content-Type: application/json' \
  -d '{"action":"toggleCheck","month":"26년 11월","name":"박종익","week":1}'
```

## 안전 원칙

- 기존 셀의 값·수식을 덮어쓰지 않습니다. 쓰기는 요청된 칸에만 합니다.
- 새 달 시트는 `insertSheet` 로 만들고, 지난 달 시트는 수정하지 않습니다.
- 이미 있는 달 탭에 이월하면 이미 있는 이름은 건너뜁니다(중복 방지).

## 파일

```
index.html            앱 화면
guide.html            설치 가이드(코드 복사 버튼 포함)
assets/app.css        스타일(라이트/다크)
assets/app.js         앱 로직(시연·시트 연결)
assets/snapshot.js    26년 11월 스냅샷
apps-script/Code.gs   구글 Apps Script 백엔드
```
