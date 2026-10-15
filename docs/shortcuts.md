# Terminal shortcuts (`shortcuts` module)

```sh
npm run setup -- shortcuts
```

| macOS / Linux (zsh, bash) | Windows (PowerShell) | Equivalent to |
|---|---|---|
| `heig:planning` | `heig-planning` | `npm run schedule -- --table` |
| `heig:deadlines` | `heig-deadlines` | `npm run deadlines` |
| `heig:courses` | `heig-courses` | `npm run courses` |
| `heig:course MAD` | `heig-course MAD` | `npm run course -- MAD` |

Options go directly after the shortcut, e.g. `heig:planning --from 2026-10-26`. Open a new terminal after the
installation. PowerShell does not allow `:` in command names, hence the `heig-` prefix on Windows; if PowerShell reports
that running scripts is disabled, allow local scripts once with `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

The shortcuts point to the current location of your HEIG-Kit copy: install them again after moving it. Remove them with
`npm run aliases -- --uninstall` (on Windows: `npm.cmd run aliases -- --uninstall`).
