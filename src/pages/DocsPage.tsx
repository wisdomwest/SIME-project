import { Eyebrow } from '../components/primitives/Eyebrow';

export function DocsPage() {
  return (
    <div className="min-h-full bg-paper overflow-y-auto">
      <div className="max-w-[960px] mx-auto px-8 py-16 space-y-16">

        {/* HERO */}
        <header className="space-y-4">
          <Eyebrow accent>SIMElab · Math reference</Eyebrow>
          <h1
            className="font-display text-ink font-light text-5xl tracking-[-0.02em] leading-[1.05]"
            style={{ fontVariationSettings: "'opsz' 144, 'SOFT' 100" }}
          >
            Interpreting Every Metric
          </h1>
          <p className="text-base text-ink-soft leading-relaxed max-w-2xl">
            What each number means, how it's computed, and how to read it in a real
            social network analysis. Every metric in the Explorer has an{' '}
            <span className="mx-1 align-middle inline-flex w-3.5 h-3.5 border border-rule rounded-full items-center justify-center text-[9px] text-ink-mute">i</span>{' '}
            tooltip — this page is the full reference.
          </p>
        </header>

        {/* ─────── NETWORK OVERVIEW ─────── */}
        <Section title="Network Overview" id="overview">
          <Metric
            name="Density"
            formula="D = 2|E| / (|V|(|V|−1))"
            body="The ratio of actual edges to all possible edges in a directed graph. A density of 0.0002 means only 0.02% of all possible connections exist."
            interpretation={[
              ['Very low (< 0.001)', 'Extremely sparse — most accounts are disconnected from most others. Normal for organic conversations on social media where people broadcast to their own followers.'],
              ['Low (0.001–0.01)', 'Sparse. Typical for hashtag campaigns where participants mention each other occasionally.'],
              ['Moderate (0.01–0.1)', 'Dense. Suggests active cross-mentioning. Could be an organized chat or internal community.'],
              ['High (> 0.1)', 'Very dense. Unusual in real social graphs — may indicate coordination or a small, tightly-knit group.'],
            ]}
          />
          <Metric
            name="Reciprocity"
            formula="R = |{ (u→v) AND (v→u) }| / |E|"
            body="The fraction of directed edges that have a matching edge in the opposite direction. R = 1 means every mention is mutual; R = 0 means nobody talks back."
            interpretation={[
              ['< 1%', 'Pure broadcast network — accounts post but don&apos;t engage with replies. Common in protest or marketing campaigns.'],
              ['1–10%', 'Sparse dialogue. A few conversational pairs amid a broadcast majority.'],
              ['10–30%', 'Active discussion. Significant back-and-forth between participants.'],
              ['> 30%', 'Highly conversational. Forum-like or small-group dynamics.'],
            ]}
          />
          <Metric
            name="Connected Components"
            formula="Number of distinct subgraphs where every node is reachable from every other"
            body="Each 'component' is an island of accounts that can reach each other but cannot reach accounts in other components. High counts mean fragmentation."
            interpretation={[
              ['1 component', 'Everyone is connected (directly or indirectly). A single conversation.'],
              ['2–20', 'Moderate fragmentation. Several distinct discussion clusters.'],
              ['20–200', 'Highly fragmented. Many separate conversations happening in parallel.'],
              ['> 200', 'Extreme fragmentation. Either time-scattered data or many unconnected sub-communities. When n ~ |V|/10, the network is essentially a collection of isolated pairs.'],
            ]}
          />
          <Metric
            name="Diameter"
            formula="max distance between any two reachable vertices (shortest path)"
            body="The longest chain of connections needed to get from one account to another within the same component. Smaller diameter = tighter network."
            interpretation={[
              ['1–3', 'Very small world. Information can spread in just 1–3 hops. Typical of coordinated clusters.'],
              ['4–8', 'Small-world network. Standard for social graphs.'],
              ['> 8', 'Long paths. Fragmented or sparse connectivity within components.'],
            ]}
          />
          <Metric
            name="Average Clustering Coefficient"
            formula="C = (1/|V|) · Σ (2·t(v)) / (deg(v)·(deg(v)−1))"
            body="How many of a node's neighbours are also connected to each other. Watts-Strogatz definition. High values mean echo chambers."
            interpretation={[
              ['< 0.1', 'Low local clustering. Neighbours don&apos;t know each other — broadcast structure.'],
              ['0.1–0.4', 'Moderate clustering. Some cliques exist but the graph is mostly open.'],
              ['0.4–0.7', 'High clustering. Strong community structure — neighbours are likely connected.'],
              ['> 0.7', 'Very high. Dense local cliques. Likely echo chambers or coordinated groups.'],
            ]}
          />
        </Section>

        {/* ─────── SNA METRICS ─────── */}
        <Section title="Social Network Analysis Metrics" id="sna">
          <Metric
            name="Degree Centrality"
            formula="deg(v) = deg_in(v) + deg_out(v)"
            body="Total number of connections (mentions + being mentioned). Highest-degree accounts are the loudest voices — they are mentioned by many and/or mention many others."
            interpretation={[
              ['High degree + low reciprocity', 'Broadcaster. Shouts into the network but doesn&apos;t engage back. Typical of news accounts, influencers, or bot accounts.'],
              ['High in-degree', 'Authority. Many people mention this account. Credible source or frequent topic.'],
              ['High out-degree', 'Hub. This account mentions many others. Curator or aggregator.'],
            ]}
          />
          <Metric
            name="Betweenness Centrality"
            formula="C_B(v) = Σ (σ_st(v) / σ_st) for all s ≠ v ≠ t"
            body="Fraction of all shortest paths in the network that pass through this node. High betweenness = bridge between communities. If this account were removed, communication between groups would suffer."
            interpretation={[
              ['> 0.1', 'Major bridge. Connects disparate communities. Critical structural role.'],
              ['0.01–0.1', 'Moderate bridging. Connects subgroups within the same community.'],
              ['< 0.01', 'Peripheral or interior. No bridging function.'],
              ['High betweenness + low degree', 'Quiet connector. Few connections but each one bridges different groups. Rare and analytically valuable.'],
            ]}
          />
          <Metric
            name="Closeness Centrality"
            formula="C_C(v) = (|V|−1) / Σ d(v,u)"
            body="How fast information spreads from this account to everyone else. Higher = shorter average path to all other nodes."
            interpretation={[
              ['> 0.5', 'Fast spreader. Can reach most of the network quickly. Central position.'],
              ['0.2–0.5', 'Moderate speed. Not optimally positioned but not isolated.'],
              ['< 0.2', 'Slow spreader. On the periphery. Takes many hops to reach others.'],
            ]}
          />
          <Metric
            name="Eigenvector Centrality"
            formula="Ax = λx"
            body="Recursive importance. An account has high eigenvector centrality if it is connected to other highly-connected accounts. PageRank's foundation."
            interpretation={[
              ['High eigenvector + low degree', 'Connected to the right people. Few but powerful ties. Potential influencer&apos;s influencer.'],
              ['High eigenvector + high degree', 'Obvious authority. Well-connected AND well-connected to the well-connected.'],
              ['Low eigenvector despite high degree', 'Connected to many isolated/weak accounts. Broadcast to the periphery.'],
            ]}
          />
          <Metric
            name="PageRank"
            formula="PR(v) = (1−d)/|V| + d · Σ PR(u)/deg_out(u)"
            body="Google's algorithm. An account is high-PageRank if it is mentioned by other high-PageRank accounts. Damping factor d = 0.85."
            interpretation={[
              ['High PageRank', 'Endorsed by authorities. Being cited by already-credible sources.'],
              ['High PageRank + low degree', 'Mentioned by few but important accounts. A quiet authority.'],
              ['Low PageRank despite high degree', 'Connected to low-authority accounts. Broadcast to the periphery.'],
            ]}
          />
        </Section>

        {/* ─────── SENTIMENT ─────── */}
        <Section title="Sentiment Analysis (K-Means)" id="sentiment">
          <p className="text-sm text-ink-soft leading-relaxed mb-6">
            The Python backend runs k-means++ (k=3) on a <strong>9-dimensional feature vector</strong>:{' '}
            in-degree, out-degree, betweenness, closeness, eigenvector, PageRank, clustering coefficient,
            reciprocity, and follower ratio — all min-max normalised. No tweet text is read.
            Clusters are re-labelled based on behavioural profile.
          </p>

          <div className="border border-rule bg-paper-2 p-4 mb-8 text-sm text-ink-soft font-mono leading-relaxed">
            x_i = [deg_in, deg_out, betweenness, closeness, eigenvector, pagerank, clustering_coeff, reciprocity, follower_ratio]
          </div>

          <Metric
            name="Silhouette Score"
            formula="s(v) = (b(v) − a(v)) / max(a(v), b(v))"
            body="For each point, a(v) = mean distance to same-cluster points, b(v) = mean distance to next-closest cluster. Averages across all points. Validates whether the 9-D features actually separate into meaningful groups."
            interpretation={[
              ['> 0.5', 'Good structural separation. The three sentiment clusters are distinct in network behaviour space.'],
              ['0.3–0.5', 'Fair. Clusters overlap somewhat — structural profiles aren&apos;t perfectly separated.'],
              ['< 0.3', 'Poor. The 9-D features don&apos;t naturally split into three groups. K-means is forcing structure where there isn&apos;t much. Sentiment labels from network structure alone may mislead.'],
            ]}
          />
          <Metric
            name="Polarisation Index"
            formula="(N_pos + N_neg) / N_total"
            body="Share of accounts sorted into the Positive or Negative clusters, excluding Neutral. High polarisation = few bystanders."
            interpretation={[
              ['> 0.8', 'Highly polarised. Almost everyone has taken a side. Only a small fraction remains neutral.'],
              ['0.5–0.8', 'Moderately polarised. A significant neutral contingent exists.'],
              ['< 0.5', 'Low polarisation. Most accounts are neutral observers — the conversation isn&apos;t structurally divisive.'],
            ]}
          />
          <Metric
            name="Centroid Distance"
            formula="|| μ_pos − μ_neg ||"
            body="Euclidean distance between the Positive and Negative cluster centres in the 9-D normalised feature space. Measures how different the two camps are in their network behaviour."
            interpretation={[
              ['> 3.0', 'Highly polarised AND structurally distinct. The two camps behave very differently in the network. One broadcasts, one connects. Easy to tell apart.'],
              ['1.0–3.0', 'Moderate separation. Some behavioural difference between camps.'],
              ['< 1.0', 'Structurally similar. The two camps have nearly identical network behaviour profiles. They are equally organised, equally active, equally connected. You cannot tell which side an account is on from network features alone. This typically means <strong>both sides are mirroring each other</strong> — same tactics, different audience. Classic echo chamber consolidation.'],
            ]}
          />
          <div className="border border-ember/30 bg-ember-soft/50 p-5 space-y-2">
            <p className="text-xs font-bold text-ember uppercase tracking-wider">Real example from your data</p>
            <p className="text-sm text-ink-soft leading-relaxed">
              <strong>Polarisation = 0.968</strong> (97% of accounts are in Pos or Neg camps — only 3% neutral){' '}
              combined with <strong>Centroid Distance = 0.44</strong> (the camps are nearly identical in behaviour){' '}
              means: this is an intensely polarised conversation where <em>both sides play the same network game</em>.
              They broadcast with equal intensity, bridge with equal frequency, and cluster with equal density.
              The structural signals alone can&apos;t distinguish #RejectFinanceBill supporters from opponents —
              they mirror each other. To separate them, you need content: hashtags, tweet text, target accounts.
            </p>
          </div>
        </Section>

        {/* ─────── DISINFORMATION ─────── */}
        <Section title="Disinformation Signals" id="disinfo">
          <p className="text-sm text-ink-soft leading-relaxed mb-6">
            Each account gets a composite score from five signals, each weighted by analytical importance:
          </p>

          <table className="w-full text-xs border-collapse mb-8">
            <thead>
              <tr className="border-b border-rule">
                <th className="text-left py-2 pr-4 font-bold text-ink">Signal</th>
                <th className="text-left py-2 pr-4 font-bold text-ink">Formula</th>
                <th className="text-left py-2 pr-4 font-bold text-ink">Weight</th>
                <th className="text-left py-2 font-bold text-ink">Detects</th>
              </tr>
            </thead>
            <tbody className="text-ink-soft">
              <tr className="border-b border-rule">
                <td className="py-2 pr-4 font-medium text-ink">Retweet amplification</td>
                <td className="py-2 pr-4 font-mono">(retweets+1)/(followers+1)</td>
                <td className="py-2 pr-4">25%</td>
                <td className="py-2">Retweet farms — accounts with massive RT volume relative to followers</td>
              </tr>
              <tr className="border-b border-rule">
                <td className="py-2 pr-4 font-medium text-ink">Temporal regularity</td>
                <td className="py-2 pr-4 font-mono">1 − σ(Δt) / μ(Δt)</td>
                <td className="py-2 pr-4">15%</td>
                <td className="py-2">Bots that post on precise, machine-like schedules</td>
              </tr>
              <tr className="border-b border-rule">
                <td className="py-2 pr-4 font-medium text-ink">Network position</td>
                <td className="py-2 pr-4 font-mono">(out_deg+1)/(out_deg + BC + 1)</td>
                <td className="py-2 pr-4">30%</td>
                <td className="py-2">Spammers who broadcast but never bridge communities</td>
              </tr>
              <tr className="border-b border-rule">
                <td className="py-2 pr-4 font-medium text-ink">Echo chamber index</td>
                <td className="py-2 pr-4 font-mono">intra_edges / total_degree</td>
                <td className="py-2 pr-4">15%</td>
                <td className="py-2">Accounts that only engage within their own community bubble</td>
              </tr>
              <tr className="border-b border-rule">
                <td className="py-2 pr-4 font-medium text-ink">Follower sparsity</td>
                <td className="py-2 pr-4 font-mono">1 − CC_ego</td>
                <td className="py-2 pr-4">15%</td>
                <td className="py-2">Followers who don&apos;t know each other — bought followers</td>
              </tr>
            </tbody>
          </table>

          <Metric
            name="Composite Risk Score"
            formula="D(v) = Σ w_i · A_i(v)"
            body="Weighted sum of all five signals. Thresholds: < 0.35 = Clean, 0.35–0.60 = Suspicious, ≥ 0.60 = Likely disinfo."
          />
          <Metric
            name="Echo Chamber Index"
            formula="intra_cluster_edges / total_degree"
            body="Fraction of an account's edges that stay within its own Louvain community. 1.0 = this account never talks to outsiders."
            interpretation={[
              ['> 0.8', 'Near-total echo chamber. Almost all interactions are within the same cluster.'],
              ['0.5–0.8', 'Strong community bias. Mostly talks within-group, some cross-group.'],
              ['< 0.5', 'Open engagement. Significant cross-community interaction.'],
            ]}
          />
        </Section>

        {/* ─────── CENSORSHIP ─────── */}
        <Section title="Censorship Indicators" id="censorship">
          <Metric
            name="Censorship Vulnerability Index (CVI)"
            formula="CVI = (1/λ₂) · max(C_B(v))"
            body="SIMElab's custom CVI divides maximum directed betweenness by the matching unnormalized Fiedler value. It is undefined for a disconnected whole network because λ₂ = 0. In that case the dashboard reports a component CVI calculated entirely within the largest connected component and states its node coverage."
            interpretation={[
              ['Whole graph λ₂ = 0', 'The graph is already disconnected. Whole-network CVI is N/A; use the component count and giant-component metrics.'],
              ['High component CVI + low λ₂', 'The giant component is fragile and contains a comparatively strong bridge account.'],
              ['Low component CVI + low λ₂', 'The giant component is fragile in general, but no single account dominates the custom ratio.'],
              ['High λ₂', 'Robust connectivity. Hard to fragment even by removing influential accounts.'],
            ]}
          />
          <Metric
            name="Fiedler Value (λ₂)"
            formula="Second-smallest eigenvalue of the Laplacian L = D − A"
            body="Measures algebraic connectivity. The whole graph has λ₂ = 0 whenever it contains multiple connected components. For an already disconnected network, SIMElab additionally reports the largest component's λ₂ and its percentage of all nodes."
            interpretation={[
              ['λ₂ = 0', 'The network is disconnected (or numerically indistinguishable from disconnected). Check the component count.'],
              ['Small positive λ₂', 'The measured connected component is fragile and has few redundant paths.'],
              ['λ₂ < 0.1', 'Very fragile. Removing a few bridges would split the graph.'],
              ['λ₂ > 0.5', 'Robust. Many redundant connections hold the graph together.'],
            ]}
          />
          <Metric
            name="Structural Hole Score"
            formula="SI(v) = C_B(v) · log(deg(v)+1)"
            body="A disappearing bridge account's impact. High SI means this account was structurally critical AND well-connected. If it vanishes between snapshots, the network likely fragmented."
          />
        </Section>

        {/* ─────── HASHTAGS ─────── */}
        <Section title="Hashtag Analysis" id="hashtags">
          <p className="text-sm text-ink-soft leading-relaxed mb-6">
            Each hashtag is scored on authenticity via a Gaussian Mixture Model, then classified into a lifecycle phase.
          </p>

          <Metric
            name="Artificial Amplification Ratio"
            formula="GMM on 7-D legitimacy feature vectors (followers, verification status, account age, hashtag diversity, engagement ratio, community integration, original content ratio)"
            body="A 2-component Gaussian Mixture Model separates accounts into 'Legitimate' (higher mean account age and hashtag diversity) and 'Artificial' (bots that repeat few hashtags). The artificial_ratio is the fraction of accounts in the artificial component."
            interpretation={[
              ['< 0.15', 'Organic hashtag. Minimal artificial amplification.'],
              ['0.15–0.40', 'Moderately amplified. Some artificial activity but mostly organic.'],
              ['> 0.40', 'Significantly artificially amplified. Coordinated bot activity is driving the hashtag. Use caution when interpreting volume as genuine interest.'],
            ]}
          />
          <Metric
            name="Lifecycle Phase"
            formula="State machine: Birth → Growth → Peak → Contestation → Co-optation → Decay → Resurrection"
            body="Each transition is detected by changes in volume, sentiment entropy, amplifier ratio, and semantic drift (cosine similarity of TF-IDF centroids)."
            interpretation={[
              ['Birth', 'First appearance. Low volume, organic scatter.'],
              ['Growth', 'Volume increasing. New accounts joining organically.'],
              ['Peak', 'Maximum volume. Sentiment polarity most extreme.'],
              ['Contestation', 'Sentiment entropy spikes > 50% in one bin. The hashtag&apos;s meaning is being fought over by opposing camps.'],
              ['Co-optation', 'Amplifier ratio crosses 0.30. Bots or adversarial accounts have taken over the hashtag narrative.'],
              ['Decay', 'Volume declining. Natural end of lifecycle.'],
              ['Resurrection', 'Volume spikes again after a lull. Often indicates a related event rekindled the topic.'],
            ]}
          />
        </Section>

        {/* ─────── DRIFT ─────── */}
        <Section title="Semantic Drift Analysis" id="drift">
          <p className="text-sm text-ink-soft leading-relaxed mb-6">
            An LLM (DeepSeek, NVIDIA NIM, or TokenRouter) samples tweets from the early and late halves
            of the campaign, extracts topics from each half, and compares them. The goal: detect whether
            the conversation's meaning shifted — and whether it was hijacked.
          </p>

          <Metric
            name="Drift Score"
            body="A 0–1 score from the LLM summarising how much the topics changed between the early and late halves. Based on semantic comparison of extracted themes."
            interpretation={[
              ['> 0.4', 'HIGH narrative shift. The topics being discussed changed significantly. The early and late conversations may be about different things entirely.'],
              ['< 0.4', 'LOW drift. The narrative remained stable throughout the campaign.'],
            ]}
          />
          <Metric
            name="Co-optation Flag"
            body="Boolean: was the hashtag or campaign hijacked by an adversarial group? The LLM cross-references topics, sentiment, and keyword shifts."
            interpretation={[
              ['YES — Co-opted', 'The hashtag started with one meaning (e.g. a genuine protest grievance) but was overtaken by a different group pushing a different agenda. Common in political astroturfing.'],
              ['NO', 'The narrative evolved organically within the same community. Any topic changes reflect natural conversation evolution rather than external hijacking.'],
            ]}
          />
          <Metric
            name="Swahili / Sheng Integration"
            body="Count of tweets in the sample containing Kenyan Swahili or Sheng slang. Measures how locally grounded the conversation is."
            interpretation={[
              ['High count', 'Grassroots, locally-driven conversation. Kenyan Swahili/Sheng usage signals authentic participation rather than imported messaging.'],
              ['Low count', 'Either the dataset has little code-switching, or the conversation is being driven by accounts that don&apos;t use local language markers. Could indicate coordinated external messaging.'],
            ]}
          />
        </Section>

        {/* ─────── COMMUNITY DETECTION ─────── */}
        <Section title="Community Detection (Louvain)" id="communities">
          <Metric
            name="Modularity"
            formula="Q = 1/(2|E|) · Σ [A_ij − k_i·k_j/(2|E|)] · δ(c_i, c_j)"
            body="Measures how good the community partition is — how many more edges are inside communities than expected by random chance. Typically 0.3–0.7 for real networks."
            interpretation={[
              ['> 0.6', 'Strong community structure. Clear, well-separated groups.'],
              ['0.3–0.6', 'Moderate structure. Communities exist but have fuzzy boundaries.'],
              ['< 0.3', 'Weak structure. The partition is barely better than random.'],
            ]}
          />
          <p className="text-sm text-ink-soft leading-relaxed mt-4">
            Community count itself is a diagnostic: too many small communities (&gt; |V|/10) suggests
            the graph is dominated by isolated pairs or triplets rather than meaningful groups.
            Too few (&lt; 5) suggests the Louvain resolution may be grouping unrelated accounts.
          </p>
        </Section>

        {/* ─────── QUICK REFERENCE ─────── */}
        <section id="quickref">
          <div className="border-t border-rule pt-8 mb-8">
            <h2
              className="font-display text-3xl text-ink font-light tracking-[-0.02em] mb-6"
              style={{ fontVariationSettings: "'opsz' 96, 'SOFT' 100" }}
            >
              Quick-Reference Grid
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b-2 border-ink text-ink">
                  <th className="text-left py-3 pr-4 font-bold">Metric</th>
                  <th className="text-left py-3 pr-4 font-bold">Low tells you</th>
                  <th className="text-left py-3 pr-4 font-bold">Moderate tells you</th>
                  <th className="text-left py-3 font-bold">High tells you</th>
                </tr>
              </thead>
              <tbody className="text-ink-soft">
                <tr className="border-b border-rule">
                  <td className="py-3 pr-4 font-medium text-ink whitespace-nowrap">Density</td>
                  <td className="py-3 pr-4">Sparse, organic — broadcast to own followers</td>
                  <td className="py-3 pr-4">Moderate cross-talk</td>
                  <td className="py-3">Very dense — possibly coordinated</td>
                </tr>
                <tr className="border-b border-rule">
                  <td className="py-3 pr-4 font-medium text-ink">Reciprocity</td>
                  <td className="py-3 pr-4">Broadcast — nobody talks back</td>
                  <td className="py-3 pr-4">Some dialogue</td>
                  <td className="py-3">Conversational — forum-like dynamics</td>
                </tr>
                <tr className="border-b border-rule">
                  <td className="py-3 pr-4 font-medium text-ink">Components</td>
                  <td className="py-3 pr-4">Fragmented — many separate groups</td>
                  <td className="py-3 pr-4">Moderate fragmentation</td>
                  <td className="py-3">One big conversation — fully connected</td>
                </tr>
                <tr className="border-b border-rule">
                  <td className="py-3 pr-4 font-medium text-ink">Silhouette</td>
                  <td className="py-3 pr-4">Unreliable k-means — clusters forced on poor data</td>
                  <td className="py-3 pr-4">Fair separation</td>
                  <td className="py-3">Good separation — reliable sentiment clusters</td>
                </tr>
                <tr className="border-b border-rule">
                  <td className="py-3 pr-4 font-medium text-ink">Polarisation</td>
                  <td className="py-3 pr-4">Bystanders dominate — low divisiveness</td>
                  <td className="py-3 pr-4">Moderate — neutral contingent present</td>
                  <td className="py-3">Everyone has taken a side</td>
                </tr>
                <tr className="border-b border-rule">
                  <td className="py-3 pr-4 font-medium text-ink">Centroid Distance</td>
                  <td className="py-3 pr-4">Camps are structurally identical — mirror each other</td>
                  <td className="py-3 pr-4">Moderate behavioural difference</td>
                  <td className="py-3">Camps behave very differently — easy to distinguish</td>
                </tr>
                <tr className="border-b border-rule">
                  <td className="py-3 pr-4 font-medium text-ink">Fiedler (λ₂)</td>
                  <td className="py-3 pr-4">Near zero — one-edge-from-fragmentation</td>
                  <td className="py-3 pr-4">Moderate connectivity</td>
                  <td className="py-3">Robust — many redundant ties hold graph together</td>
                </tr>
                <tr className="border-b border-rule">
                  <td className="py-3 pr-4 font-medium text-ink">Drift Score</td>
                  <td className="py-3 pr-4">Stable narrative — conversation stayed on topic</td>
                  <td className="py-3 pr-4">Moderate shift</td>
                  <td className="py-3">Narrative hijacked or evolved significantly</td>
                </tr>
                <tr className="border-b border-rule">
                  <td className="py-3 pr-4 font-medium text-ink">Artificial Ratio</td>
                  <td className="py-3 pr-4">Organic campaign — minimal bot activity</td>
                  <td className="py-3 pr-4">Mixed — some artificial amplification</td>
                  <td className="py-3">Heavily botted — hashtag volume is not genuine</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <footer className="border-t border-rule pt-8 text-[10px] uppercase tracking-[0.18em] text-ink-mute font-semibold">
          SIMElab Africa · Freida Brown Innovation Center · USIU-Africa, Nairobi
        </footer>
      </div>
    </div>
  );
}

/* ─── COMPONENTS ─── */

function Section({ title, id, children }: { title: string; id: string; children: React.ReactNode }) {
  return (
    <section id={id}>
      <div className="border-t border-rule pt-8 mb-8">
        <a href={`#${id}`} className="group inline-flex items-center gap-2">
          <h2
            className="font-display text-3xl text-ink font-light tracking-[-0.02em] group-hover:text-ember transition-colors"
            style={{ fontVariationSettings: "'opsz' 96, 'SOFT' 100" }}
          >
            {title}
          </h2>
          <span className="text-ink-mute opacity-0 group-hover:opacity-100 transition-opacity text-sm">#</span>
        </a>
      </div>
      {children}
    </section>
  );
}

function Metric({
  name,
  formula,
  body,
  interpretation,
}: {
  name: string;
  formula?: string;
  body: string;
  interpretation?: [string, string][];
}) {
  return (
    <div className="mb-8 last:mb-0 border border-rule bg-paper-2 p-5 space-y-3">
      <h3 className="font-display text-xl text-ink font-light">{name}</h3>
      {formula && (
        <div className="bg-paper border border-rule p-3 text-sm text-ink-soft font-mono leading-relaxed">
          {formula}
        </div>
      )}
      <p className="text-sm text-ink-soft leading-relaxed">{body}</p>
      {interpretation && interpretation.length > 0 && (
        <div className="space-y-1.5 mt-3">
          <p className="text-[10px] font-bold text-ink-mute uppercase tracking-wider">What the numbers mean</p>
          <table className="w-full text-xs border-collapse">
            <tbody>
              {interpretation.map(([range, meaning], i) => (
                <tr key={i} className={i < interpretation.length - 1 ? 'border-b border-rule/50' : ''}>
                  <td className="py-1.5 pr-4 align-top font-mono text-ink font-medium whitespace-nowrap">{range}</td>
                  <td className="py-1.5 align-top text-ink-soft">{meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
