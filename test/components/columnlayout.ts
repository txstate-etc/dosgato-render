import { Component } from '@dosgato/templating'

export class ColumnLayoutTemplate extends Component {
  static templateKey = 'columnlayout'
  static cssBlocks = new Map([
    ['columnlayout', {
      css: `
        .column-layout {
          display: flex;
          max-width: 100%;
        }
        .column-layout > div {
          width:25%;
        }
      `
    }]
  ])

  render () {
    return `
      <div class="column-layout">
        ${this.renderArea('row', { wrap: ({ output }) => `<div>${output}</div>` })}
      </div>
    `
  }
}
