import GymLog from "@/components/GymLog";

// One page: everything happens in the browser. The static HTML holds the header and a loading
// placeholder, so the app shows something before its script has loaded.
export default function Page() {
  return <GymLog />;
}
