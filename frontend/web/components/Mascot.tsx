import Image from "next/image";

// The approved SpeakUp dinosaur. These are the supplied PNGs, used as they
// are: seated, one oval eye, a small nostril, no mouth. Nothing is redrawn or
// recoloured. What state the app is in is said with text and small icons next
// to the image, never by changing the image.
//
//   neutral    welcome, empty, loading, success, errors
//   recording  ready to record and recording (holds a microphone)
//   results    transcript, scores and feedback (holds a page)

export type MascotState = "neutral" | "recording" | "results";

// Each file is 1283 by 1226 with transparent padding around the artwork. These
// are the artwork's bounds, the same in all three files to within two pixels.
// Cropping to them gives every mascot the same visual size and puts its base
// exactly on the bottom edge of the box, so it can sit on things.
const SOURCE = { width: 1283, height: 1226 };
const ART = { left: 165, top: 73, width: 909, height: 1000 };

export function Mascot({
  state = "neutral",
  flip = false,
  alt = "",
  sizes = "320px",
  className,
}: {
  state?: MascotState;
  /** Face left. The artwork faces right. */
  flip?: boolean;
  /** Leave empty when nearby text already says what is happening. */
  alt?: string;
  /** Roughly how wide the whole image is drawn, for choosing a file size. */
  sizes?: string;
  /** Set the width here, for example "w-40". The height follows. */
  className?: string;
}) {
  return (
    <span
      data-mascot={state}
      className={`relative block overflow-hidden ${className ?? ""}`}
      style={{ aspectRatio: `${ART.width} / ${ART.height}`, transform: flip ? "scaleX(-1)" : undefined }}
    >
      <Image
        src={`/mascot/mascot-${state}.png`}
        alt={alt}
        width={SOURCE.width}
        height={SOURCE.height}
        sizes={sizes}
        className="absolute max-w-none"
        style={{
          width: `${(SOURCE.width / ART.width) * 100}%`,
          height: "auto",
          left: `${(-ART.left / ART.width) * 100}%`,
          top: `${(-ART.top / ART.height) * 100}%`,
        }}
      />
    </span>
  );
}
