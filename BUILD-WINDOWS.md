# Triglav – namestitev na Windows

## Hitri način

Dvoklikni **`install.bat`**

Počakaj, da se zgradi namestitveni program. Nato v mapi `dist\` zaženi:

- **`Triglav-Setup-1.2.0.exe`** ← namestitveni program (priporočeno)
- ali `Triglav-1.2.0-portable.exe` ← brez namestitve

## Ročno

```bat
npm install
npm run build:installer
```

## Kaj naredi Setup

- Namesti Triglav v `AppData\Local\Programs\Triglav` (ali izbrano mapo)
- Ustvari bližnjico na namizju
- Ustvari vnos v Start meniju
- Omogoči odstranitev prek Nastavitve → Aplikacije

## Zahteve

- Windows 10/11 (64-bit)
- Node.js 18+ (samo za gradnjo)
- ~500 MB prostora med gradnjo
