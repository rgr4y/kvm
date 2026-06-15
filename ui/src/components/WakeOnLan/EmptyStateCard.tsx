import { LuPlus } from "react-icons/lu";
import {useReactAt} from 'i18n-auto-extractor/react'

export default function EmptyStateCard({
  setShowAddForm,
}: {
  onCancelWakeOnLanModal: () => void;
  setShowAddForm: (show: boolean) => void;
}) {
  const { $at }= useReactAt();

  return (
    <div className="select-none space-y-4 w-full">
      <div
        className="flex w-full animate-fadeIn opacity-0 items-center justify-end space-x-2"
        style={{
          animationDuration: "0.7s",
          animationDelay: "0.2s",
        }}
      >
        <div id="addDeviceBtn" onClick={() => setShowAddForm(true)}
                className="w-full max-w-xs mx-auto border-2 border-dashed border-blue-300/30 rounded-xl py-4 px-6 text-blue-400 font-medium hover:bg-blue-500/10 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:ring-opacity-50 cursor-pointer">
          <span className="inline-flex items-center gap-2"><LuPlus />{$at("Add a device to start using Wake-on-LAN")}</span>
        </div>

      </div>
    </div>
  );
}
