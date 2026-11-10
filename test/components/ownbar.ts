import { Component, type ComponentData } from '@dosgato/templating'
import { htmlEncode } from 'txstate-utils'

export interface OwnBarData extends ComponentData {
  text: string
}

/**
 * Prints its own edit bar inside its markup (renderIncludesEditBar), so tests can check
 * that a customized area swaps that bar for a Customize Bar in place.
 */
export class OwnBarTemplate extends Component<OwnBarData> {
  static templateKey = 'ownbar'

  renderIncludesEditBar = true

  render () {
    return `<div class="dg-ownbar"><div class="dg-ownbar-header">${this.editBar()}</div><span>${htmlEncode(this.data.text)}</span></div>`
  }
}
