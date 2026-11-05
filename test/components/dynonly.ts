import { Component, type ComponentData } from '@dosgato/templating'
import { htmlEncode } from 'txstate-utils'

export interface DynOnlyData extends ComponentData {
  name: string
  text: string
}

// only allowed in dynamic areas (by prefix), never in a page's static areas
export class DynOnlyTemplate extends Component<DynOnlyData> {
  static templateKey = 'dynonly'

  render () {
    return `
      <div class="dg-dynonly">
        ${htmlEncode(this.data.name)}: ${htmlEncode(this.data.text)}
      </div>`
  }
}
