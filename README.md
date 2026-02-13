# gh-pr-menu-tui

TUI (terminal UI) en TypeScript/Node.js que asiste el flujo de Pull Requests usando **GitHub CLI (gh)** y **git**.

## Requisitos
- Node.js 18+ (recomendado 20+)
- `gh` instalado y en PATH
- `git` instalado y en PATH

## Instalación
```bash
npm install
```

## Ejecutar en modo desarrollo
```bash
npm run dev
```

## Compilar y ejecutar
```bash
npm run build
npm start
```

## Instalar globalmente

```bash
#mediante enlace
npm link
#por copia
npm i -g .
```

## Ejecutar globalmente

```bash
gh-pr-menu
```


## Controles
- `↑/↓` navegar por el menú
- `Enter` ejecutar opción
- `Tab` cambia el foco entre menú y panel de salida
- `q` o `Ctrl+C` salir

## Notas
- La vista de PR y comentarios usa **REST** (evita GraphQL y el warning de Projects classic).
- El comentario inline (review) es guiado: elige fichero, hunk, puedes buscar texto, eliges una línea válida (R123/L88).
- Borrar rama solo funciona si la rama está en el mismo repositorio (no fork) y tienes permisos.
