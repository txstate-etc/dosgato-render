import { Component } from '@dosgato/templating'

export class HorizontalRuleTemplate extends Component {
  static templateKey = 'horizontalrule'
  static cssBlocks = new Map([
    ['horizontalrule', {
      css: `
        .dg-horizontalrule { height: 2px; border: none; background-color: #666666; }
      `
    }]
  ])

  noData = true

  render () {
    return '<hr class="dg-horizonalrule">'
  }
}
