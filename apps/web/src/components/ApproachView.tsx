import type { ReactNode } from "react";
import type { ApproachObservation, Review } from "../api/types";

function InlineCode({ text }: { text: string }): ReactNode {
  return text.split("`").map((piece, index) => (index % 2 === 1 ? <code key={index}>{piece}</code> : piece));
}

function Observation({ observation }: { observation: ApproachObservation }) {
  return (
    <div className="approach-observation" data-verdict={observation.verdict}>
      <p className="approach-observation-head">
        <span className="approach-verdict">{observation.verdict === "fits" ? "Fits" : "Concern"}</span>
        <InlineCode text={observation.title} />
        {observation.checkInReview ? <span className="muted small"> · will check in review</span> : null}
      </p>
      <ul>
        {observation.points.map((point, index) => (
          <li key={index}>
            <InlineCode text={point} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ApproachView({ review, empty }: { review: Review; empty: ReactNode }) {
  if (review.approachParts && review.approachParts.length > 0) {
    return (
      <>
        {review.approachSummary ? (
          <p className="approach-overview">
            <InlineCode text={review.approachSummary} />
          </p>
        ) : null}
        <ol className="approach-parts">
          {review.approachParts.map((part, index) => (
            <li key={index} className="approach-part">
              <h3>
                <InlineCode text={part.title} />
              </h3>
              <ul>
                {part.points.map((point, pointIndex) => (
                  <li key={pointIndex}>
                    <InlineCode text={point} />
                  </li>
                ))}
              </ul>
              {part.observations.map((observation, observationIndex) => (
                <Observation key={observationIndex} observation={observation} />
              ))}
            </li>
          ))}
        </ol>
      </>
    );
  }

  if (!review.approachSummary) return <>{empty}</>;

  return (
    <>
      <p className="prose">{review.approachSummary}</p>
      {review.approachObservation ? (
        <aside className="callout">
          <span className="callout-label">Observation</span>
          <p>{review.approachObservation}</p>
        </aside>
      ) : null}
    </>
  );
}
