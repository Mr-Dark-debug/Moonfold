// The production icon, as GitHub shows the Moonfold app, whatever this build's channel.
import appIconUrl from "../../../../assets/prod/moonfold-black-web-apple-touch-180.png";

export function MoonfoldAppIcon(props: { readonly className?: string }) {
  return <img src={appIconUrl} alt="" className={props.className} />;
}
