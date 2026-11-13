----------------------------------------------------------------------------------
-- Project Name : sdfg
-- Module Name  : sdfg.vhd
-- Entity Name  : sdfg
-- Architecture : Behavioral
-- Target Lang  : VHDL-2008
-- Engineer     : (Unspecified)
-- Create Date  : 2026-11-08
-- Tool Versions: GHDL 6.0.0
----------------------------------------------------------------------------------

library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity sdfg is
  port (
    clk          : in    std_logic;
    data_out     : out   std_logic_vector(7 downto 0)
  );
end entity sdfg;

architecture Behavioral of sdfg is
begin

    -- Sequential process with asynchronous reset

end architecture Behavioral;
