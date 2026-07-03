import { Component, type ComponentData } from '@dosgato/templating'
import { htmlEncode } from 'txstate-utils'

export interface TeamData extends ComponentData {
  title: string
}

export class TeamTemplate extends Component<TeamData> {
  static templateKey = 'team'
  static cssBlocks = new Map([
    ['team', {
      css: `
        .dg-team {
          margin: 1em 0;
          padding: 1em;
          border: 1px solid #CCCCCC;
        }
        .dg-team > h3 { margin-top: 0; }
        .dg-team-members {
          display: flex;
          flex-wrap: wrap;
          gap: 1em;
        }
      `
    }]
  ])

  newLabel () {
    return 'Add Team Member'
  }

  render () {
    return `
      <div class="dg-team">
        <h3>${htmlEncode(this.data.title)}</h3>
        <div class="dg-team-members">${this.renderArea('members')}</div>
      </div>
    `
  }
}
