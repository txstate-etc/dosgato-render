import { Component, type ComponentData } from '@dosgato/templating'
import { htmlEncode, isNotBlank } from 'txstate-utils'

export interface TeamMemberData extends ComponentData {
  name: string
  role?: string
}

export class TeamMemberTemplate extends Component<TeamMemberData> {
  static templateKey = 'teammember'
  static cssBlocks = new Map([
    ['teammember', {
      css: `
        .dg-teammember {
          padding: 0.5em 1em;
          border: 1px solid #DDDDDD;
          background-color: #F5F5F5;
        }
        .dg-teammember-name { font-weight: bold; }
        .dg-teammember-role { color: #666666; }
      `
    }]
  ])

  newLabel () {
    return 'Add Team'
  }

  render () {
    return `
      <div class="dg-teammember">
        <div class="dg-teammember-name">${htmlEncode(this.data.name)}</div>
        ${isNotBlank(this.data.role) ? `<div class="dg-teammember-role">${htmlEncode(this.data.role)}</div>` : ''}
        ${this.renderArea('teams')}
      </div>
    `
  }
}
